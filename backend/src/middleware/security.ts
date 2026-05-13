import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { redis } from "../lib/redis.js";
import { AppError } from "../lib/errors.js";

const memoryCounters = new Map<string, { count: number; resetAt: number }>();

async function checkLimit(key: string, limit: number, windowSeconds: number) {
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    if (current > limit) {
      throw new AppError(429, "Rate limit exceeded", "RATE_LIMITED");
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const now = Date.now();
    const item = memoryCounters.get(key);
    if (!item || item.resetAt < now) {
      memoryCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return;
    }
    item.count += 1;
    if (item.count > limit) {
      throw new AppError(429, "Rate limit exceeded", "RATE_LIMITED");
    }
  }
}

export function registerSecurity(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", env.FRONTEND_URL);
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }
    await checkLimit(`rl:ip:${request.ip}`, 100, 60);
  });

  app.addHook("preHandler", async request => {
    if (request.user) {
      await checkLimit(`rl:user:${request.user.id}`, 1000, 60);
    }
  });
}
