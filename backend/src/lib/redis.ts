import { Redis } from "ioredis";
import { env } from "../config/env.js";

type RedisClient = InstanceType<typeof Redis>;

const globalForRedis = globalThis as unknown as { redis?: RedisClient };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
