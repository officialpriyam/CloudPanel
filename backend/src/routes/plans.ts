import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parseParams } from "../lib/validation.js";
import { requireAuth } from "../services/auth.js";
import { writeAudit } from "../lib/audit.js";

export async function planRoutes(app: FastifyInstance) {
  app.get("/plans", async () => {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { pricePerHour: "asc" }
    });
    return { data: plans };
  });

  app.post("/plans/:id/upgrade", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(z.object({ id: z.string() }), request);
    const plan = await prisma.plan.findFirstOrThrow({ where: { id, active: true } });
    const subscription = await prisma.$transaction(async tx => {
      await tx.userSubscription.updateMany({
        where: { userId: user.id, status: "ACTIVE" },
        data: { status: "CANCELED", currentPeriodEnd: new Date() }
      });
      return tx.userSubscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: "ACTIVE"
        },
        include: { plan: true }
      });
    });
    await writeAudit({ userId: user.id, action: "plan.upgrade", target: plan.id, ip: request.ip });
    return { subscription };
  });

  app.get("/plans/current", async request => {
    const user = await requireAuth(request);
    const subscription = await prisma.userSubscription.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    });
    return { subscription };
  });
}
