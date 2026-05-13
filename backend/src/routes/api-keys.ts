import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { createApiKey, requireAuth } from "../services/auth.js";
import { writeAudit } from "../lib/audit.js";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.string().min(1).max(80)).default(["vms:read"])
});

export async function apiKeyRoutes(app: FastifyInstance) {
  app.get("/api-keys", async request => {
    const user = await requireAuth(request);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.aPIKey.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.post("/api-keys", async request => {
    const user = await requireAuth(request);
    const body = parseBody(createSchema, request);
    const result = await createApiKey(user.id, body.name, body.scopes);
    await writeAudit({ userId: user.id, action: "api-key.create", target: result.apiKey.id, ip: request.ip });
    return {
      apiKey: {
        id: result.apiKey.id,
        name: result.apiKey.name,
        prefix: result.apiKey.prefix,
        scopes: result.apiKey.scopes
      },
      token: result.token
    };
  });

  app.delete("/api-keys/:id", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(z.object({ id: z.string() }), request);
    await prisma.aPIKey.updateMany({
      where: { id, userId: user.id },
      data: { revokedAt: new Date() }
    });
    await writeAudit({ userId: user.id, action: "api-key.revoke", target: id, ip: request.ip });
    return { ok: true };
  });
}
