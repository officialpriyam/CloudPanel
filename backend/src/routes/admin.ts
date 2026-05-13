import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayProvider, Role, UserStatus, VMStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/crypto.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { requireRole } from "../services/auth.js";
import { ProxmoxService } from "../services/proxmox.js";
import { writeAudit } from "../lib/audit.js";
import { getPlatformSettings, platformSettingsSchema, savePlatformSettings } from "../services/settings.js";

const idParams = z.object({ id: z.string() });

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/dashboard", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const [totalUsers, totalVms, activeVms, revenueAll, nodes, openTickets] = await Promise.all([
      prisma.user.count(),
      prisma.vM.count({ where: { deletedAt: null } }),
      prisma.vM.count({ where: { status: VMStatus.RUNNING } }),
      prisma.transaction.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
      prisma.node.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.ticket.count({ where: { status: { in: ["OPEN", "WAITING"] } } })
    ]);
    return {
      metrics: {
        totalUsers,
        totalVms,
        activeVms,
        revenueAll: revenueAll._sum.amount ?? 0,
        openTickets
      },
      nodes
    };
  });

  app.get("/admin/users", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const query = parseQuery(cursorQuerySchema.extend({
      search: z.string().optional(),
      status: z.nativeEnum(UserStatus).optional()
    }), request);
    const items = await prisma.user.findMany({
      where: {
        status: query.status,
        OR: query.search ? [
          { email: { contains: query.search, mode: "insensitive" } },
          { name: { contains: query.search, mode: "insensitive" } }
        ] : undefined
      },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items.map(stripPassword), query.limit);
  });

  app.get("/admin/users/:id", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const { id } = parseParams(idParams, request);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { vms: true, tickets: true, transactions: { take: 25, orderBy: { createdAt: "desc" } } }
    });
    return { user: stripPassword(user) };
  });

  app.patch("/admin/users/:id", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const { id } = parseParams(idParams, request);
    const body = parseBody(z.object({
      name: z.string().min(2).optional(),
      status: z.nativeEnum(UserStatus).optional(),
      role: z.nativeEnum(Role).optional(),
      resourceCpuLimit: z.number().int().nullable().optional(),
      resourceRamLimit: z.number().int().nullable().optional(),
      resourceDiskLimit: z.number().int().nullable().optional()
    }), request);
    const user = await prisma.user.update({ where: { id }, data: body });
    await writeAudit({ userId: actor.id, action: "admin.user.update", target: id, metadata: body, ip: request.ip });
    return { user: stripPassword(user) };
  });

  app.get("/admin/nodes", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    return { data: await prisma.node.findMany({ orderBy: { createdAt: "desc" } }) };
  });

  app.post("/admin/nodes", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(z.object({
      name: z.string().min(2),
      cluster: z.string().min(2),
      host: z.string().min(3),
      port: z.number().int().min(1).max(65535).default(8006),
      tokenId: z.string().min(3),
      tokenSecret: z.string().min(3),
      tlsFingerprint: z.string().optional()
    }), request);
    const node = await prisma.node.create({
      data: {
        name: body.name,
        cluster: body.cluster,
        host: body.host,
        port: body.port,
        tokenId: body.tokenId,
        tokenSecretEncrypted: encryptSecret(body.tokenSecret),
        tlsFingerprint: body.tlsFingerprint
      }
    });
    await writeAudit({ userId: actor.id, action: "admin.node.create", target: node.id, ip: request.ip });
    return { node };
  });

  app.post("/admin/nodes/:id/test", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const { id } = parseParams(idParams, request);
    const node = await prisma.node.findUniqueOrThrow({ where: { id } });
    const ok = await new ProxmoxService(node).testConnection();
    return { ok };
  });

  app.delete("/admin/nodes/:id", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const { id } = parseParams(idParams, request);
    await prisma.node.delete({ where: { id } });
    await writeAudit({ userId: actor.id, action: "admin.node.delete", target: id, ip: request.ip });
    return { ok: true };
  });

  app.get("/admin/gateways", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER]);
    return { data: await prisma.paymentGateway.findMany({ orderBy: { provider: "asc" } }) };
  });

  app.post("/admin/gateways", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(z.object({
      provider: z.nativeEnum(GatewayProvider),
      name: z.string().min(2),
      active: z.boolean().default(false),
      config: z.record(z.unknown()).default({}),
      webhookSecret: z.string().optional()
    }), request);
    const gateway = await prisma.paymentGateway.upsert({
      where: { provider_name: { provider: body.provider, name: body.name } },
      create: {
        provider: body.provider,
        name: body.name,
        active: body.active,
        configEncrypted: encryptSecret(JSON.stringify(body.config)),
        webhookSecretEncrypted: body.webhookSecret ? encryptSecret(body.webhookSecret) : undefined
      },
      update: {
        active: body.active,
        configEncrypted: encryptSecret(JSON.stringify(body.config)),
        webhookSecretEncrypted: body.webhookSecret ? encryptSecret(body.webhookSecret) : undefined
      }
    });
    await writeAudit({ userId: actor.id, action: "admin.gateway.upsert", target: gateway.id, ip: request.ip });
    return { gateway };
  });

  app.get("/admin/announcements", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    return { data: await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } }) };
  });

  app.post("/admin/announcements", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(z.object({
      title: z.string().min(3).max(160),
      body: z.string().min(3).max(4000),
      active: z.boolean().default(true)
    }), request);
    const announcement = await prisma.announcement.create({ data: body });
    await writeAudit({ userId: actor.id, action: "admin.announcement.create", target: announcement.id, ip: request.ip });
    return { announcement };
  });

  app.get("/admin/settings", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER]);
    return { data: await prisma.systemSetting.findMany(), platform: await getPlatformSettings() };
  });

  app.put("/admin/platform-settings", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(platformSettingsSchema.partial(), request);
    const settings = await savePlatformSettings(body);
    await writeAudit({ userId: actor.id, action: "admin.platform-settings.update", metadata: settings, ip: request.ip });
    return { settings };
  });

  app.put("/admin/settings/:key", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const { key } = z.object({ key: z.string() }).parse(request.params);
    const { value } = parseBody(z.object({ value: z.unknown() }), request);
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never }
    });
    await writeAudit({ userId: actor.id, action: "admin.setting.update", target: key, ip: request.ip });
    return { setting };
  });

  app.get("/admin/audit-logs", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.auditLog.findMany({
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.get("/admin/plans", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    return { data: await prisma.plan.findMany({ orderBy: { pricePerHour: "asc" } }) };
  });

  app.post("/admin/plans", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(z.object({
      name: z.string().min(2).max(120),
      slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
      description: z.string().optional(),
      cpuCores: z.number().int().min(1),
      ramMb: z.number().int().min(256),
      diskGb: z.number().int().min(5),
      bandwidthGb: z.number().int().nullable().optional(),
      maxVms: z.number().int().min(0).max(1000).default(1),
      maxSnapshots: z.number().int().min(0).max(1000).default(2),
      backupsEnabled: z.boolean().default(false),
      pricePerHour: z.number().int().min(0),
      setupFee: z.number().int().min(0).default(0),
      currency: z.string().length(3).default("usd"),
      active: z.boolean().default(true)
    }), request);
    const plan = await prisma.plan.upsert({
      where: { slug: body.slug },
      create: body,
      update: body
    });
    await writeAudit({ userId: actor.id, action: "admin.plan.upsert", target: plan.id, metadata: body, ip: request.ip });
    return { plan };
  });
}

function stripPassword<T extends { passwordHash?: string | null }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}
