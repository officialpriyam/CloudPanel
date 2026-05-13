import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { redis } from "../lib/redis.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { parseBody, parseParams } from "../lib/validation.js";
import {
  createTotpSecret,
  hashPassword,
  issueTokenPair,
  requireAuth,
  requireRole,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyPassword,
  verifyTotp
} from "../services/auth.js";
import { writeAudit } from "../lib/audit.js";
import { getPlatformSettings } from "../services/settings.js";
import { queues } from "../workers/queues.js";

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().min(2).max(120),
  password: z.string().min(10).max(200)
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  totp: z.string().optional()
});

const refreshSchema = z.object({ refreshToken: z.string().min(20) });
const totpVerifySchema = z.object({ token: z.string().min(6).max(8) });
const providerSchema = z.object({ provider: z.enum(["google", "github", "oidc"]) });
const emailVerifySchema = z.object({ token: z.string().min(20) });

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const settings = await getPlatformSettings();
    if (!settings.allowRegistration) {
      badRequest("Registration is disabled");
    }
    const body = parseBody(registerSchema, request);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) {
      badRequest("Email is already registered");
    }
    const userCount = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: userCount === 0 ? Role.OWNER : Role.CLIENT,
        emailVerifiedAt: settings.requireEmailVerification ? null : new Date()
      }
    });
    if (settings.requireEmailVerification) {
      await createEmailVerification(user.id, user.email);
    }
    await writeAudit({ userId: user.id, action: "auth.register", target: user.id, ip: request.ip });
    reply.code(201).send({
      user: publicUser(user),
      tokens: await issueTokenPair(user)
    });
  });

  app.post("/auth/login", async (request) => {
    const settings = await getPlatformSettings();
    const body = parseBody(loginSchema, request);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      unauthorized("Invalid email or password");
    }
    if (settings.requireEmailVerification && !user.emailVerifiedAt) {
      unauthorized("Email verification is required");
    }
    if (settings.forceUser2fa && !user.totpEnabled) {
      unauthorized("Two-factor authentication must be enabled before login");
    }
    if (user.totpEnabled) {
      if (!body.totp || !user.totpSecret || !verifyTotp(user.totpSecret, body.totp)) {
        unauthorized("Two-factor token is required");
      }
    }
    await writeAudit({ userId: user.id, action: "auth.login", target: user.id, ip: request.ip });
    return { user: publicUser(user), tokens: await issueTokenPair(user) };
  });

  app.post("/auth/refresh", async request => {
    const body = parseBody(refreshSchema, request);
    return { tokens: await rotateRefreshToken(body.refreshToken) };
  });

  app.post("/auth/logout", async request => {
    const body = parseBody(refreshSchema, request);
    await revokeRefreshToken(body.refreshToken);
    return { ok: true };
  });

  app.get("/auth/me", async request => {
    const user = await requireAuth(request);
    const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { user: publicUser(full) };
  });

  app.post("/auth/2fa/setup", async request => {
    const user = await requireAuth(request);
    const secret = createTotpSecret(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret.secret, totpEnabled: false } });
    await writeAudit({ userId: user.id, action: "auth.2fa.setup", target: user.id, ip: request.ip });
    return secret;
  });

  app.post("/auth/2fa/verify", async request => {
    const user = await requireAuth(request);
    const body = parseBody(totpVerifySchema, request);
    const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!full.totpSecret || !verifyTotp(full.totpSecret, body.token)) {
      badRequest("Invalid two-factor token");
    }
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await writeAudit({ userId: user.id, action: "auth.2fa.enabled", target: user.id, ip: request.ip });
    return { enabled: true };
  });

  app.post("/auth/email-verification/send", async request => {
    const user = await requireAuth(request);
    await createEmailVerification(user.id, user.email);
    return { sent: true };
  });

  app.post("/auth/email-verification/verify", async request => {
    const body = parseBody(emailVerifySchema, request);
    const userId = await redis.get(`email-verify:${body.token}`);
    if (!userId) {
      badRequest("Email verification token is invalid or expired");
    }
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await redis.del(`email-verify:${body.token}`);
    await writeAudit({ userId, action: "auth.email.verified", target: userId, ip: request.ip });
    return { verified: true };
  });

  app.get("/auth/oauth/:provider/start", async (request, reply) => {
    const { provider } = parseParams(providerSchema, request);
    const settings = await getPlatformSettings();
    if ((provider === "google" && !settings.oauthGoogleEnabled) || (provider === "github" && !settings.oauthGithubEnabled) || (provider === "oidc" && !settings.oidcEnabled)) {
      badRequest("OAuth provider is disabled");
    }
    const state = randomUUID();
    await redis.set(`oauth:state:${state}`, provider, "EX", 600);
    reply.redirect(await oauthUrl(provider, state));
  });

  app.get("/auth/oauth/:provider/callback", async (request, reply) => {
    const { provider } = parseParams(providerSchema, request);
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    const expected = await redis.get(`oauth:state:${query.state}`);
    if (expected !== provider) {
      badRequest("Invalid OAuth state");
    }
    await redis.del(`oauth:state:${query.state}`);
    const profile = await exchangeOAuthProfile(provider, query.code);
    const user = await prisma.user.upsert({
      where: { email: profile.email },
      create: {
        email: profile.email,
        name: profile.name,
        emailVerifiedAt: new Date(),
        oauthAccounts: {
          create: { provider, providerId: profile.id }
        }
      },
      update: {
        name: profile.name,
        oauthAccounts: {
          upsert: {
            where: { provider_providerId: { provider, providerId: profile.id } },
            create: { provider, providerId: profile.id },
            update: {}
          }
        }
      }
    });
    const tokens = await issueTokenPair(user);
    const redirectUrl = new URL("/login", env.FRONTEND_URL);
    redirectUrl.searchParams.set("accessToken", tokens.accessToken);
    redirectUrl.searchParams.set("refreshToken", tokens.refreshToken);
    reply.redirect(redirectUrl.toString());
  });

  app.post("/auth/impersonate/:userId", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER]);
    const { userId } = z.object({ userId: z.string() }).parse(request.params);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await writeAudit({ userId: request.user?.id, action: "auth.impersonate", target: user.id, ip: request.ip });
    return { user: publicUser(user), tokens: await issueTokenPair(user) };
  });
}

async function createEmailVerification(userId: string, email: string) {
  const token = cryptoRandomToken();
  await redis.set(`email-verify:${token}`, userId, "EX", 60 * 60 * 24);
  const url = `${env.FRONTEND_URL}/login?verifyToken=${encodeURIComponent(token)}`;
  await queues.notifications.add("email", {
    to: email,
    subject: "Verify your CloudPanel email",
    html: `<p>Verify your CloudPanel account by opening this link:</p><p><a href="${url}">${url}</a></p>`,
    text: `Verify your CloudPanel account: ${url}`
  });
}

function cryptoRandomToken() {
  return randomBytes(32).toString("hex");
}

function publicUser(user: { id: string; email: string; name: string; role: Role; status: string; credits: number; currency: string; totpEnabled: boolean; emailVerifiedAt?: Date | null; kycStatus?: string }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    credits: user.credits,
    currency: user.currency,
    totpEnabled: user.totpEnabled,
    emailVerifiedAt: user.emailVerifiedAt,
    kycStatus: user.kycStatus
  };
}

async function oauthUrl(provider: "google" | "github" | "oidc", state: string): Promise<string> {
  const callback = `${env.BACKEND_PUBLIC_URL}/api/v1/auth/oauth/${provider}/callback`;
  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return url.toString();
  }
  if (provider === "github") {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return url.toString();
  }
  if (!env.OIDC_ISSUER_URL) {
    badRequest("OIDC is not configured");
  }
  const discovery = await fetch(`${env.OIDC_ISSUER_URL.replace(/\/$/, "")}/.well-known/openid-configuration`).then(r => r.json() as Promise<{ authorization_endpoint: string }>);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", env.OIDC_CLIENT_ID);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeOAuthProfile(provider: "google" | "github" | "oidc", code: string): Promise<{ id: string; email: string; name: string }> {
  const callback = `${env.BACKEND_PUBLIC_URL}/api/v1/auth/oauth/${provider}/callback`;
  if (provider === "google") {
    const token = await postForm<{ access_token: string }>("https://oauth2.googleapis.com/token", {
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: callback
    });
    const profile = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` }
    }).then(r => r.json() as Promise<{ sub: string; email: string; name: string }>);
    return { id: profile.sub, email: profile.email, name: profile.name };
  }
  if (provider === "github") {
    const token = await postForm<{ access_token: string }>("https://github.com/login/oauth/access_token", {
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callback
    });
    const profile = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" }
    }).then(r => r.json() as Promise<{ id: number; email?: string; name?: string; login: string }>);
    const emails = await fetch("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" }
    }).then(r => r.json() as Promise<Array<{ email: string; primary: boolean; verified: boolean }>>);
    const email = profile.email ?? emails.find(item => item.primary && item.verified)?.email;
    if (!email) {
      badRequest("GitHub account does not expose a verified email");
    }
    return { id: String(profile.id), email, name: profile.name ?? profile.login };
  }
  const discovery = await fetch(`${env.OIDC_ISSUER_URL.replace(/\/$/, "")}/.well-known/openid-configuration`).then(r => r.json() as Promise<{ token_endpoint: string; userinfo_endpoint: string }>);
  const token = await postForm<{ access_token: string }>(discovery.token_endpoint, {
    client_id: env.OIDC_CLIENT_ID,
    client_secret: env.OIDC_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: callback
  });
  const profile = await fetch(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${token.access_token}` }
  }).then(r => r.json() as Promise<{ sub: string; email: string; name?: string }>);
  return { id: profile.sub, email: profile.email, name: profile.name ?? profile.email };
}

async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params)
  });
  if (!response.ok) {
    badRequest(`OAuth token exchange failed: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}
