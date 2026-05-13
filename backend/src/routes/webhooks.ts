import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayProvider } from "@prisma/client";
import { handleStripeWebhook } from "../services/payments.js";
import { creditUser } from "../services/billing.js";
import { env } from "../config/env.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { ProxmoxService } from "../services/proxmox.js";

const provisioningSchema = z.object({
  action: z.enum(["CreateAccount", "TerminateAccount", "SuspendAccount", "UnsuspendAccount", "ChangePackage", "Status"]),
  serviceId: z.string(),
  userEmail: z.string().email().optional(),
  userName: z.string().optional(),
  vmId: z.string().optional(),
  nodeId: z.string().optional(),
  planId: z.string().optional(),
  osTemplate: z.string().optional(),
  ipCount: z.number().int().optional()
});

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/stripe", async request => {
    return handleStripeWebhook(String((request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? {})), request.headers["stripe-signature"] as string | undefined);
  });

  app.post("/webhooks/razorpay", async request => {
    const body = z.object({
      event: z.string(),
      payload: z.object({
        payment: z.object({
          entity: z.object({
            id: z.string(),
            amount: z.number().int(),
            currency: z.string(),
            notes: z.object({ userId: z.string() }).passthrough()
          })
        })
      })
    }).parse(request.body);
    if (body.event === "payment.captured") {
      await creditUser({
        userId: body.payload.payment.entity.notes.userId,
        amount: body.payload.payment.entity.amount,
        currency: body.payload.payment.entity.currency.toLowerCase(),
        gateway: GatewayProvider.RAZORPAY,
        gatewayRef: body.payload.payment.entity.id,
        description: "Razorpay credit top-up"
      });
    }
    return { received: true };
  });

  app.post("/webhooks/paypal", async request => {
    const body = z.object({
      event_type: z.string(),
      resource: z.object({
        id: z.string(),
        amount: z.object({ value: z.string(), currency_code: z.string() }),
        custom_id: z.string().optional()
      }).passthrough()
    }).parse(request.body);
    if (body.event_type === "PAYMENT.CAPTURE.COMPLETED" && body.resource.custom_id) {
      await creditUser({
        userId: body.resource.custom_id,
        amount: Math.round(Number(body.resource.amount.value) * 100),
        currency: body.resource.amount.currency_code.toLowerCase(),
        gateway: GatewayProvider.PAYPAL,
        gatewayRef: body.resource.id,
        description: "PayPal credit top-up"
      });
    }
    return { received: true };
  });

  app.post("/whmcs", async request => {
    const apiKey = request.headers["x-cloudpanel-whmcs-key"];
    if (apiKey !== env.WHMCS_API_KEY) {
      unauthorized("Invalid WHMCS API key");
    }
    return handleProvisioningAction(provisioningSchema.parse(request.body));
  });

  app.post("/paymenter", async request => {
    const apiKey = request.headers["x-cloudpanel-paymenter-key"];
    if (apiKey !== env.PAYMENTER_API_KEY) {
      unauthorized("Invalid Paymenter API key");
    }
    const body = z.object({
      action: z.enum(["create", "terminate", "suspend", "unsuspend", "upgrade", "status", "credit"]),
      serviceId: z.string(),
      userEmail: z.string().email().optional(),
      userName: z.string().optional(),
      vmId: z.string().optional(),
      nodeId: z.string().optional(),
      planId: z.string().optional(),
      amount: z.number().int().optional(),
      currency: z.string().length(3).optional()
    }).parse(request.body);

    if (body.action === "credit") {
      if (!body.userEmail || !body.amount) badRequest("userEmail and amount are required");
      const user = await prisma.user.upsert({
        where: { email: body.userEmail },
        create: { email: body.userEmail, name: body.userName ?? body.userEmail, emailVerifiedAt: new Date() },
        update: {}
      });
      await creditUser({
        userId: user.id,
        amount: body.amount,
        currency: body.currency ?? user.currency,
        gateway: GatewayProvider.MANUAL,
        gatewayRef: body.serviceId,
        description: "Paymenter credit top-up"
      });
      return { ok: true };
    }

    if (body.action === "status") {
      const vm = await findWhmcsVm(body.vmId, body.serviceId);
      return { status: vm?.status ?? "UNKNOWN" };
    }

    const whmcsActionMap = {
      create: "CreateAccount",
      terminate: "TerminateAccount",
      suspend: "SuspendAccount",
      unsuspend: "UnsuspendAccount",
      upgrade: "ChangePackage"
    } as const;

    return handleProvisioningAction({
      action: whmcsActionMap[body.action],
      serviceId: body.serviceId,
      userEmail: body.userEmail,
      userName: body.userName,
      vmId: body.vmId,
      nodeId: body.nodeId,
      planId: body.planId
    });
  });
}

async function handleProvisioningAction(body: z.output<typeof provisioningSchema>) {
  if (body.action === "Status") {
    const vm = await findWhmcsVm(body.vmId, body.serviceId);
    return { status: vm?.status ?? "UNKNOWN" };
  }

  if (body.action === "CreateAccount") {
    if (!body.userEmail || !body.nodeId || !body.planId) {
      badRequest("userEmail, nodeId, and planId are required");
    }
    const [node, plan, template] = await Promise.all([
      prisma.node.findUniqueOrThrow({ where: { id: body.nodeId } }),
      prisma.plan.findUniqueOrThrow({ where: { id: body.planId } }),
      body.osTemplate ? prisma.oSTemplate.findUnique({ where: { slug: body.osTemplate } }) : Promise.resolve(null)
    ]);
    const user = await prisma.user.upsert({
      where: { email: body.userEmail },
      create: { email: body.userEmail, name: body.userName ?? body.userEmail, emailVerifiedAt: new Date() },
      update: { name: body.userName ?? undefined }
    });
    const vm = await prisma.vM.create({
      data: {
        externalRef: body.serviceId,
        userId: user.id,
        nodeId: node.id,
        planId: plan.id,
        templateId: template?.id,
        name: `service-${body.serviceId}`.replace(/[^a-zA-Z0-9-]/g, "-"),
        cpuCores: plan.cpuCores,
        ramMb: plan.ramMb,
        diskGb: plan.diskGb,
        bridge: "vmbr0",
        hourlyPrice: plan.pricePerHour,
        currency: plan.currency,
        status: "PROVISIONING"
      }
    });
    const provisioned = await new ProxmoxService(node).createVM({
      name: vm.name,
      cores: vm.cpuCores,
      memoryMb: vm.ramMb,
      diskGb: vm.diskGb,
      bridge: vm.bridge,
      templateStorage: template?.storage,
      templatePath: template?.path
    });
    const updated = await prisma.vM.update({
      where: { id: vm.id },
      data: { proxmoxVmId: provisioned.vmid, status: "STOPPED" }
    });
    return { ok: true, vmId: updated.id, status: updated.status };
  }

  const vm = await findWhmcsVm(body.vmId, body.serviceId);
  if (!vm) {
    badRequest("VM not found for service");
  }
  const service = new ProxmoxService(vm.node);
  if (body.action === "TerminateAccount") {
    await service.deleteVM(vm);
    await prisma.vM.update({ where: { id: vm.id }, data: { status: "DELETED", deletedAt: new Date() } });
  }
  if (body.action === "SuspendAccount") {
    await service.stopVM(vm);
    await prisma.vM.update({ where: { id: vm.id }, data: { status: "SUSPENDED", suspendedAt: new Date() } });
  }
  if (body.action === "UnsuspendAccount") {
    await service.startVM(vm);
    await prisma.vM.update({ where: { id: vm.id }, data: { status: "RUNNING", suspendedAt: null } });
  }
  if (body.action === "ChangePackage") {
    if (!body.planId) badRequest("planId is required");
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: body.planId } });
    await prisma.vM.update({
      where: { id: vm.id },
      data: {
        planId: plan.id,
        cpuCores: plan.cpuCores,
        ramMb: plan.ramMb,
        diskGb: plan.diskGb,
        hourlyPrice: plan.pricePerHour,
        currency: plan.currency
      }
    });
  }
  return { ok: true, action: body.action, serviceId: body.serviceId };
}

async function findWhmcsVm(vmId: string | undefined, serviceId: string) {
  return prisma.vM.findFirst({
    where: { OR: [{ id: vmId }, { externalRef: serviceId }] },
    include: { node: true }
  });
}
