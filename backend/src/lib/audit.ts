import { prisma } from "./prisma.js";

export async function writeAudit(input: {
  userId?: string;
  action: string;
  target?: string;
  metadata?: unknown;
  ip?: string;
}) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      target: input.target,
      metadata: input.metadata === undefined ? undefined : JSON.parse(JSON.stringify(input.metadata)),
      ip: input.ip
    }
  });
}
