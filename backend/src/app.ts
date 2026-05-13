import "./types.js";
import Fastify from "fastify";
import { authRoutes } from "./routes/auth.js";
import { planRoutes } from "./routes/plans.js";
import { vmRoutes } from "./routes/vms.js";
import { billingRoutes } from "./routes/billing.js";
import { ticketRoutes } from "./routes/tickets.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { knowledgeBaseRoutes } from "./routes/knowledge-base.js";
import { kycRoutes } from "./routes/kyc.js";
import { deploymentRoutes } from "./routes/deployments.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { registerSecurity } from "./middleware/security.js";
import { authenticateApiKey, authenticateRequest } from "./services/auth.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    },
    bodyLimit: 5 * 1024 * 1024
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    try {
      const rawBody = String(body || "{}");
      (request as unknown as { rawBody?: string }).rawBody = rawBody;
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      done(null, parsed);
    } catch (error) {
      done(error as Error);
    }
  });

  app.addHook("preHandler", async request => {
    const header = request.headers.authorization;
    if (!header || request.user) {
      return;
    }
    if (header.startsWith("Bearer ")) {
      await authenticateRequest(request);
    }
    if (header.startsWith("ApiKey ")) {
      await authenticateApiKey(request);
    }
  });

  registerSecurity(app);
  registerErrorHandler(app);

  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    return { ok: true, service: "cloudpanel-api" };
  });

  app.register(authRoutes, { prefix: "/api/v1" });
  app.register(planRoutes, { prefix: "/api/v1" });
  app.register(vmRoutes, { prefix: "/api/v1" });
  app.register(billingRoutes, { prefix: "/api/v1" });
  app.register(ticketRoutes, { prefix: "/api/v1" });
  app.register(apiKeyRoutes, { prefix: "/api/v1" });
  app.register(adminRoutes, { prefix: "/api/v1" });
  app.register(webhookRoutes, { prefix: "/api/v1" });
  app.register(knowledgeBaseRoutes, { prefix: "/api/v1" });
  app.register(kycRoutes, { prefix: "/api/v1" });
  app.register(deploymentRoutes, { prefix: "/api/v1" });

  app.get("/api/v1/docs", async () => ({
    title: "CloudPanel API",
    version: "v1",
    auth: "Bearer access token or ApiKey token",
    routes: [
      "POST /auth/register",
      "POST /auth/login",
      "POST /auth/refresh",
      "GET /plans",
      "POST /plans/:id/upgrade",
      "GET,POST /vms",
      "GET,DELETE /vms/:id",
      "POST /vms/:id/start|stop|reboot|rebuild|console",
      "GET /vms/:id/stats",
      "GET /vms/:id/stats/sse",
      "GET,POST,DELETE /vms/:id/firewall",
      "GET /billing/balance",
      "GET /billing/transactions",
      "POST /billing/topup",
      "GET,POST /tickets",
      "GET,POST,DELETE /api-keys",
      "GET /admin/dashboard",
      "GET,POST /admin/nodes",
      "GET,POST /admin/plans",
      "GET,PUT /admin/platform-settings",
      "GET,POST /admin/knowledge-base",
      "GET,PATCH /admin/kyc",
      "GET,POST /deploy/projects",
      "GET /admin/users",
      "POST /webhooks/stripe|razorpay|paypal",
      "POST /whmcs",
      "POST /paymenter"
    ]
  }));

  return app;
}
