import { request } from "undici";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export async function createCloudflareDnsRecord(input: { type: "A" | "AAAA" | "CNAME"; name: string; content: string; proxied?: boolean }) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
    throw new AppError(503, "Cloudflare is not configured", "CLOUDFLARE_NOT_CONFIGURED");
  }
  const response = await request(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const body = await response.body.json();
  if (response.statusCode >= 400) {
    throw new AppError(response.statusCode, "Cloudflare DNS request failed", "CLOUDFLARE_ERROR", body);
  }
  return body;
}

export async function createPterodactylServer(input: Record<string, unknown>) {
  if (!env.PTERODACTYL_URL || !env.PTERODACTYL_API_KEY) {
    throw new AppError(503, "Pterodactyl is not configured", "PTERODACTYL_NOT_CONFIGURED");
  }
  const response = await request(`${env.PTERODACTYL_URL.replace(/\/$/, "")}/api/application/servers`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.PTERODACTYL_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(input)
  });
  const body = await response.body.json();
  if (response.statusCode >= 400) {
    throw new AppError(response.statusCode, "Pterodactyl request failed", "PTERODACTYL_ERROR", body);
  }
  return body;
}
