import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DeploymentProvider, Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/crypto.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { requireAuth, requireRole } from "../services/auth.js";
import { writeAudit } from "../lib/audit.js";
import { queues } from "../workers/queues.js";
import { forbidden } from "../lib/errors.js";

const projectSchema = z.object({
  name: z.string().min(2).max(120),
  provider: z.nativeEnum(DeploymentProvider).default(DeploymentProvider.GIT),
  repoUrl: z.string().url().optional(),
  branch: z.string().min(1).max(120).default("main"),
  buildCommand: z.string().max(300).optional(),
  outputDir: z.string().max(180).optional(),
  sftpEndpointId: z.string().optional(),
  environment: z.record(z.string()).default({})
});

export async function deploymentRoutes(app: FastifyInstance) {
  app.get("/deploy/projects", async request => {
    const user = await requireAuth(request);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.deploymentProject.findMany({
      where: user.role === Role.CLIENT ? { userId: user.id } : {},
      include: { deployments: { orderBy: { createdAt: "desc" }, take: 3 }, sftpEndpoint: true },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.post("/deploy/projects", async request => {
    const user = await requireAuth(request);
    const body = parseBody(projectSchema, request);
    const project = await prisma.deploymentProject.create({
      data: {
        userId: user.id,
        name: body.name,
        provider: body.provider,
        repoUrl: body.repoUrl,
        branch: body.branch,
        buildCommand: body.buildCommand,
        outputDir: body.outputDir,
        sftpEndpointId: body.sftpEndpointId,
        environment: body.environment
      }
    });
    await writeAudit({ userId: user.id, action: "deploy.project.create", target: project.id, ip: request.ip });
    return { project };
  });

  app.post("/deploy/projects/:id/deploy", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(z.object({ id: z.string() }), request);
    const body = parseBody(z.object({ commitSha: z.string().optional(), artifactUrl: z.string().url().optional() }), request);
    const project = await prisma.deploymentProject.findUniqueOrThrow({ where: { id } });
    if (user.role === Role.CLIENT && project.userId !== user.id) {
      forbidden();
    }
    const deployment = await prisma.deployment.create({
      data: {
        projectId: project.id,
        status: "QUEUED",
        commitSha: body.commitSha,
        artifactUrl: body.artifactUrl
      }
    });
    await queues.deployments.add("run-deployment", { deploymentId: deployment.id }, { attempts: 2 });
    return { deployment };
  });

  app.get("/admin/deployments", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.deployment.findMany({
      include: { project: { include: { user: true } } },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.get("/admin/sftp-endpoints", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER]);
    return { data: await prisma.sftpEndpoint.findMany({ orderBy: { createdAt: "desc" } }) };
  });

  app.post("/admin/sftp-endpoints", async request => {
    const actor = await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const body = parseBody(z.object({
      name: z.string().min(2).max(120),
      host: z.string().min(3).max(255),
      port: z.number().int().min(1).max(65535).default(22),
      username: z.string().min(1).max(120),
      password: z.string().optional(),
      privateKey: z.string().optional(),
      rootPath: z.string().min(1).default("/")
    }), request);
    const endpoint = await prisma.sftpEndpoint.create({
      data: {
        name: body.name,
        host: body.host,
        port: body.port,
        username: body.username,
        passwordEncrypted: body.password ? encryptSecret(body.password) : undefined,
        privateKeyEncrypted: body.privateKey ? encryptSecret(body.privateKey) : undefined,
        rootPath: body.rootPath
      }
    });
    await writeAudit({ userId: actor.id, action: "admin.sftp.create", target: endpoint.id, ip: request.ip });
    return { endpoint };
  });
}
