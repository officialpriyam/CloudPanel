import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { requireRole } from "../services/auth.js";
import { getPlatformSettings } from "../services/settings.js";
import { writeAudit } from "../lib/audit.js";

const categorySchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(160),
  active: z.boolean().default(true)
});

const articleSchema = z.object({
  categoryId: z.string(),
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(180),
  body: z.string().min(10),
  active: z.boolean().default(true)
});

export async function knowledgeBaseRoutes(app: FastifyInstance) {
  app.get("/support/config", async () => {
    const settings = await getPlatformSettings();
    return {
      supportMode: settings.supportMode,
      supportExternalUrl: settings.supportExternalUrl
    };
  });

  app.get("/knowledge-base/categories", async () => ({
    data: await prisma.knowledgeBaseCategory.findMany({
      where: { active: true },
      include: { articles: { where: { active: true }, orderBy: { title: "asc" } } },
      orderBy: { title: "asc" }
    })
  }));

  app.get("/knowledge-base/articles", async request => {
    const query = parseQuery(cursorQuerySchema.extend({ q: z.string().optional(), categoryId: z.string().optional() }), request);
    const items = await prisma.knowledgeBaseArticle.findMany({
      where: {
        active: true,
        categoryId: query.categoryId,
        OR: query.q ? [
          { title: { contains: query.q, mode: "insensitive" } },
          { body: { contains: query.q, mode: "insensitive" } }
        ] : undefined
      },
      include: { category: true },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.get("/knowledge-base/articles/:slug", async request => {
    const { slug } = parseParams(z.object({ slug: z.string() }), request);
    return {
      article: await prisma.knowledgeBaseArticle.findFirstOrThrow({
        where: { slug, active: true },
        include: { category: true }
      })
    };
  });

  app.get("/admin/knowledge-base/categories", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    return { data: await prisma.knowledgeBaseCategory.findMany({ include: { articles: true }, orderBy: { title: "asc" } }) };
  });

  app.post("/admin/knowledge-base/categories", async request => {
    const user = await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const body = parseBody(categorySchema, request);
    const category = await prisma.knowledgeBaseCategory.upsert({
      where: { slug: body.slug },
      create: body,
      update: body
    });
    await writeAudit({ userId: user.id, action: "admin.kb.category.upsert", target: category.id, ip: request.ip });
    return { category };
  });

  app.post("/admin/knowledge-base/articles", async request => {
    const user = await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const body = parseBody(articleSchema, request);
    const article = await prisma.knowledgeBaseArticle.upsert({
      where: { slug: body.slug },
      create: body,
      update: body
    });
    await writeAudit({ userId: user.id, action: "admin.kb.article.upsert", target: article.id, ip: request.ip });
    return { article };
  });
}
