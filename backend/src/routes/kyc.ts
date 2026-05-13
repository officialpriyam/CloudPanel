import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KYCStatus, Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { requireAuth, requireRole } from "../services/auth.js";
import { writeAudit } from "../lib/audit.js";

const kycCreateSchema = z.object({
  legalName: z.string().min(2).max(180),
  country: z.string().min(2).max(80),
  documentType: z.string().min(2).max(80),
  documentNumber: z.string().min(3).max(120),
  documentUrl: z.string().url().optional()
});

export async function kycRoutes(app: FastifyInstance) {
  app.get("/kyc", async request => {
    const user = await requireAuth(request);
    const submissions = await prisma.kYCSubmission.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    });
    return { status: submissions[0]?.status ?? "NOT_SUBMITTED", submissions };
  });

  app.post("/kyc", async request => {
    const user = await requireAuth(request);
    const body = parseBody(kycCreateSchema, request);
    const submission = await prisma.kYCSubmission.create({
      data: { userId: user.id, ...body, status: KYCStatus.PENDING }
    });
    await prisma.user.update({ where: { id: user.id }, data: { kycStatus: KYCStatus.PENDING } });
    await writeAudit({ userId: user.id, action: "kyc.submit", target: submission.id, ip: request.ip });
    return { submission };
  });

  app.get("/admin/kyc", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const query = parseQuery(cursorQuerySchema.extend({ status: z.nativeEnum(KYCStatus).optional() }), request);
    const items = await prisma.kYCSubmission.findMany({
      where: { status: query.status },
      include: { user: true },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.patch("/admin/kyc/:id", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const { id } = parseParams(z.object({ id: z.string() }), request);
    const body = parseBody(z.object({ status: z.enum(["APPROVED", "REJECTED"]), notes: z.string().max(1000).optional() }), request);
    const submission = await prisma.kYCSubmission.update({
      where: { id },
      data: {
        status: body.status,
        notes: body.notes,
        reviewedBy: actor.id,
        reviewedAt: new Date()
      }
    });
    await prisma.user.update({ where: { id: submission.userId }, data: { kycStatus: body.status } });
    await writeAudit({ userId: actor.id, action: "admin.kyc.review", target: submission.id, metadata: body, ip: request.ip });
    return { submission };
  });
}
