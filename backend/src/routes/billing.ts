import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayProvider, Role, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseQuery } from "../lib/validation.js";
import { requireAuth, requireRole } from "../services/auth.js";
import { createTopupSession } from "../services/payments.js";
import { adjustCredits } from "../services/billing.js";
import { writeAudit } from "../lib/audit.js";

const topupSchema = z.object({
  amount: z.number().int().min(100).max(1_000_000),
  currency: z.string().length(3).default("usd"),
  gateway: z.nativeEnum(GatewayProvider).default(GatewayProvider.STRIPE)
});

const adminCreditSchema = z.object({
  userId: z.string(),
  amount: z.number().int(),
  reason: z.string().min(3).max(300)
});

export async function billingRoutes(app: FastifyInstance) {
  app.get("/billing/balance", async request => {
    const user = await requireAuth(request);
    const full = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { credits: true, currency: true }
    });
    return { balance: full };
  });

  app.get("/billing/transactions", async request => {
    const user = await requireAuth(request);
    const query = parseQuery(cursorQuerySchema.extend({
      type: z.nativeEnum(TransactionType).optional(),
      vmId: z.string().optional()
    }), request);
    const items = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: query.type,
        vmId: query.vmId
      },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.post("/billing/topup", async request => {
    const user = await requireAuth(request);
    const body = parseBody(topupSchema, request);
    const result = await createTopupSession({
      userId: user.id,
      email: user.email,
      amount: body.amount,
      currency: body.currency
    });
    await writeAudit({ userId: user.id, action: "billing.topup.create", metadata: { amount: body.amount, gateway: body.gateway }, ip: request.ip });
    return result;
  });

  app.get("/billing/invoices", async request => {
    const user = await requireAuth(request);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.invoice.findMany({
      where: { userId: user.id },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.post("/admin/billing/credits", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(adminCreditSchema, request);
    const balance = await adjustCredits({ userId: body.userId, amount: body.amount, reason: body.reason });
    await writeAudit({ userId: actor.id, action: "admin.billing.adjust", target: body.userId, metadata: body, ip: request.ip });
    return { balance };
  });
}
