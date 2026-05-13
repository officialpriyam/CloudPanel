import { Queue } from "bullmq";
import { redis } from "../lib/redis.js";

export const queues = {
  billing: new Queue("billing", { connection: redis }),
  vm: new Queue("vm", { connection: redis }),
  notifications: new Queue("notifications", { connection: redis }),
  invoices: new Queue("invoices", { connection: redis }),
  health: new Queue("health", { connection: redis }),
  webhooks: new Queue("webhooks", { connection: redis }),
  deployments: new Queue("deployments", { connection: redis })
};

export async function scheduleRepeatableJobs() {
  await queues.billing.add("hourly-billing", {}, {
    repeat: { pattern: "0 * * * *" },
    jobId: "hourly-billing"
  });
  await queues.health.add("node-health", {}, {
    repeat: { pattern: "*/5 * * * *" },
    jobId: "node-health"
  });
}
