import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { FirewallAction, KYCStatus, Role, VMStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { requireAuth, requireRole } from "../services/auth.js";
import { ProxmoxService } from "../services/proxmox.js";
import { writeAudit } from "../lib/audit.js";
import { getPlatformSettings } from "../services/settings.js";

const idParams = z.object({ id: z.string() });
const createVmSchema = z.object({
  name: z.string().min(3).max(64).regex(/^[a-zA-Z0-9-]+$/),
  nodeId: z.string(),
  planId: z.string(),
  templateId: z.string().optional(),
  cpuCores: z.number().int().min(1).max(128).optional(),
  ramMb: z.number().int().min(256).max(1_048_576).optional(),
  diskGb: z.number().int().min(5).max(32_768).optional(),
  bridge: z.string().min(2).max(64).default("vmbr0")
});
const firewallSchema = z.object({
  action: z.nativeEnum(FirewallAction),
  direction: z.enum(["in", "out"]),
  protocol: z.string().min(2).max(16).default("tcp"),
  port: z.string().max(64).optional(),
  source: z.string().max(128).optional(),
  destination: z.string().max(128).optional(),
  comment: z.string().max(180).optional(),
  enabled: z.boolean().default(true)
});

export async function vmRoutes(app: FastifyInstance) {
  app.get("/nodes", async request => {
    await requireAuth(request);
    const data = await prisma.node.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, cluster: true, status: true }
    });
    return { data };
  });

  app.get("/vms", async request => {
    const user = await requireAuth(request);
    const query = parseQuery(cursorQuerySchema, request);
    const where = user.role === Role.CLIENT ? { userId: user.id, deletedAt: null } : { deletedAt: null };
    const items = await prisma.vM.findMany({
      where,
      include: { node: true, plan: true, primaryIp: true },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.post("/vms", async request => {
    const user = await requireAuth(request);
    const settings = await getPlatformSettings();
    const body = parseBody(createVmSchema, request);
    const [node, plan, template] = await Promise.all([
      prisma.node.findUnique({ where: { id: body.nodeId } }),
      prisma.plan.findUnique({ where: { id: body.planId } }),
      body.templateId ? prisma.oSTemplate.findUnique({ where: { id: body.templateId } }) : Promise.resolve(null)
    ]);
    if (!node || node.status !== "ACTIVE") {
      badRequest("Selected node is not available");
    }
    if (!plan || !plan.active) {
      badRequest("Selected plan is not available");
    }
    const cpuCores = body.cpuCores ?? plan.cpuCores;
    const ramMb = body.ramMb ?? plan.ramMb;
    const diskGb = body.diskGb ?? plan.diskGb;
    if (user.role === Role.CLIENT) {
      const fullUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (settings.forceUser2fa && !fullUser.totpEnabled) forbidden("Two-factor authentication is required before creating VMs");
      if (settings.kycRequiredForVmCreate && fullUser.kycStatus !== KYCStatus.APPROVED) forbidden("KYC approval is required before creating VMs");
      if (fullUser.resourceCpuLimit && cpuCores > fullUser.resourceCpuLimit) forbidden("CPU limit exceeded");
      if (fullUser.resourceRamLimit && ramMb > fullUser.resourceRamLimit) forbidden("RAM limit exceeded");
      if (fullUser.resourceDiskLimit && diskGb > fullUser.resourceDiskLimit) forbidden("Disk limit exceeded");
      const activeVmCount = await prisma.vM.count({ where: { userId: user.id, deletedAt: null, status: { not: VMStatus.DELETED } } });
      const activeSubscription = await prisma.userSubscription.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        include: { plan: true },
        orderBy: { createdAt: "desc" }
      });
      const vmLimit = activeSubscription?.plan.maxVms ?? plan.maxVms ?? settings.defaultMaxVms;
      if (activeVmCount >= vmLimit) forbidden(`VM limit reached for current plan (${vmLimit})`);
    }

    const created = await prisma.vM.create({
      data: {
        userId: user.id,
        nodeId: node.id,
        planId: plan.id,
        templateId: template?.id,
        name: body.name,
        cpuCores,
        ramMb,
        diskGb,
        bridge: body.bridge,
        hourlyPrice: plan.pricePerHour,
        currency: plan.currency,
        status: VMStatus.PROVISIONING
      }
    });

    try {
      const result = await new ProxmoxService(node).createVM({
        name: body.name,
        cores: cpuCores,
        memoryMb: ramMb,
        diskGb,
        bridge: body.bridge,
        templateStorage: template?.storage,
        templatePath: template?.path
      });
      const vm = await prisma.vM.update({
        where: { id: created.id },
        data: { proxmoxVmId: result.vmid, status: VMStatus.STOPPED },
        include: { node: true, plan: true }
      });
      await writeAudit({ userId: user.id, action: "vm.create", target: vm.id, metadata: { taskId: result.taskId }, ip: request.ip });
      return { vm };
    } catch (error) {
      await prisma.vM.update({ where: { id: created.id }, data: { status: VMStatus.ERROR } });
      throw error;
    }
  });

  app.get("/vms/:id", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    return { vm };
  });

  app.delete("/vms/:id", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    if (vm.proxmoxVmId) {
      await new ProxmoxService(vm.node).deleteVM(vm);
    }
    const updated = await prisma.vM.update({
      where: { id },
      data: { status: VMStatus.DELETED, deletedAt: new Date() }
    });
    await writeAudit({ userId: user.id, action: "vm.delete", target: id, ip: request.ip });
    return { vm: updated };
  });

  app.post("/vms/:id/start", async request => vmAction(request, "start"));
  app.post("/vms/:id/stop", async request => vmAction(request, "stop"));
  app.post("/vms/:id/reboot", async request => vmAction(request, "reboot"));

  app.post("/vms/:id/rebuild", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    if (vm.status === VMStatus.RUNNING) {
      await new ProxmoxService(vm.node).stopVM(vm);
    }
    await writeAudit({ userId: user.id, action: "vm.rebuild", target: vm.id, ip: request.ip });
    return { vm: await prisma.vM.update({ where: { id }, data: { status: VMStatus.STOPPED } }) };
  });

  app.post("/vms/:id/console", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    const ticket = await new ProxmoxService(vm.node).getVncTicket(vm);
    return {
      console: {
        websocketUrl: `/api/v1/vms/${vm.id}/console/ws?port=${encodeURIComponent(ticket.port)}&ticket=${encodeURIComponent(ticket.ticket)}`,
        ticket
      }
    };
  });

  app.get("/vms/:id/stats", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    const stats = await new ProxmoxService(vm.node).getVMStatus(vm);
    return { stats: stats.data };
  });

  app.get("/vms/:id/stats/sse", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    const service = new ProxmoxService(vm.node);
    const send = async () => {
      try {
        const stats = await service.getVMStatus(vm);
        reply.raw.write(`event: stats\ndata: ${JSON.stringify(stats.data)}\n\n`);
      } catch (error) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`);
      }
    };
    await send();
    const timer = setInterval(send, 5000);
    request.raw.on("close", () => clearInterval(timer));
  });

  app.get("/vms/:id/firewall", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    const localRules = await prisma.firewallRule.findMany({ where: { vmId: vm.id }, orderBy: { createdAt: "asc" } });
    let proxmoxRules: Array<Record<string, unknown>> = [];
    if (vm.proxmoxVmId) {
      const result = await new ProxmoxService(vm.node).getVMFirewallRules(vm);
      proxmoxRules = result.data;
    }
    return { data: localRules, proxmox: proxmoxRules };
  });

  app.post("/vms/:id/firewall", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const body = parseBody(firewallSchema, request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    const service = new ProxmoxService(vm.node);
    await service.createVMFirewallRule(vm, body);
    const proxmoxRules = await service.getVMFirewallRules(vm).catch(() => ({ data: [] as Array<Record<string, unknown>> }));
    const lastRule = proxmoxRules.data.at(-1);
    const position = typeof lastRule?.pos === "number" ? lastRule.pos : undefined;
    const rule = await prisma.firewallRule.create({
      data: {
        vmId: vm.id,
        action: body.action,
        direction: body.direction,
        protocol: body.protocol,
        port: body.port,
        source: body.source,
        destination: body.destination,
        comment: body.comment,
        enabled: body.enabled,
        position
      }
    });
    await writeAudit({ userId: user.id, action: "vm.firewall.create", target: vm.id, metadata: body, ip: request.ip });
    return { rule };
  });

  app.delete("/vms/:id/firewall/:ruleId", async request => {
    const user = await requireAuth(request);
    const { id, ruleId } = parseParams(z.object({ id: z.string(), ruleId: z.string() }), request);
    const vm = await loadVisibleVm(id, user.id, user.role);
    const rule = await prisma.firewallRule.findFirst({ where: { id: ruleId, vmId: vm.id } });
    if (!rule) notFound("Firewall rule not found");
    if (rule.position !== null && rule.position !== undefined) {
      await new ProxmoxService(vm.node).deleteVMFirewallRule(vm, rule.position);
    }
    await prisma.firewallRule.delete({ where: { id: ruleId } });
    await writeAudit({ userId: user.id, action: "vm.firewall.delete", target: vm.id, metadata: { ruleId }, ip: request.ip });
    return { ok: true };
  });

  app.get("/admin/vms", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.vM.findMany({
      where: { deletedAt: null },
      include: { user: true, node: true, plan: true },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });
}

async function vmAction(request: FastifyRequest, action: "start" | "stop" | "reboot") {
  const user = await requireAuth(request);
  const { id } = parseParams(idParams, request);
  const vm = await loadVisibleVm(id, user.id, user.role);
  const service = new ProxmoxService(vm.node);
  if (action === "start") {
    await service.startVM(vm);
    await prisma.vM.update({ where: { id }, data: { status: VMStatus.RUNNING } });
  }
  if (action === "stop") {
    await service.stopVM(vm);
    await prisma.vM.update({ where: { id }, data: { status: VMStatus.STOPPED } });
  }
  if (action === "reboot") {
    await service.rebootVM(vm);
  }
  await writeAudit({ userId: user.id, action: `vm.${action}`, target: id, ip: request.ip });
  return { vm: await prisma.vM.findUniqueOrThrow({ where: { id }, include: { node: true, plan: true } }) };
}

async function loadVisibleVm(id: string, userId: string, role: Role) {
  const vm = await prisma.vM.findUnique({
    where: { id },
    include: { node: true, plan: true, primaryIp: true, user: true }
  });
  if (!vm || vm.deletedAt) {
    notFound("VM not found");
  }
  if (role === Role.CLIENT && vm.userId !== userId) {
    forbidden();
  }
  return vm;
}
