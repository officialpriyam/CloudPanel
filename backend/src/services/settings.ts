import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const platformSettingsSchema = z.object({
  allowRegistration: z.boolean().default(true),
  requireEmailVerification: z.boolean().default(false),
  forceUser2fa: z.boolean().default(false),
  kycRequiredForVmCreate: z.boolean().default(false),
  supportMode: z.enum(["TICKETS", "KNOWLEDGE_BASE", "EXTERNAL_LINK", "BOTH"]).default("BOTH"),
  supportExternalUrl: z.string().url().optional().or(z.literal("")).default(""),
  oauthGoogleEnabled: z.boolean().default(true),
  oauthGithubEnabled: z.boolean().default(true),
  oidcEnabled: z.boolean().default(false),
  defaultMaxVms: z.number().int().min(0).max(1000).default(1),
  paymenterEnabled: z.boolean().default(false),
  whmcsEnabled: z.boolean().default(true)
});

export type PlatformSettings = z.output<typeof platformSettingsSchema>;

const defaultSettings = platformSettingsSchema.parse({});

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "platform." } }
  });
  const value = { ...defaultSettings };
  for (const row of rows) {
    const key = row.key.replace("platform.", "") as keyof PlatformSettings;
    if (key in value) {
      (value as Record<string, unknown>)[key] = row.value;
    }
  }
  return platformSettingsSchema.parse(value);
}

export async function savePlatformSettings(input: Partial<PlatformSettings>) {
  const current = await getPlatformSettings();
  const next = platformSettingsSchema.parse({ ...current, ...input });
  await prisma.$transaction(
    Object.entries(next).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key: `platform.${key}` },
        create: { key: `platform.${key}`, value: value as never },
        update: { value: value as never }
      })
    )
  );
  return next;
}
