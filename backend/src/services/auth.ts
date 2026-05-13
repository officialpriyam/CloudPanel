import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import type { FastifyRequest } from "fastify";
import { Role, UserStatus, type User } from "@prisma/client";
import { env } from "../config/env.js";
import { sha256 } from "../lib/crypto.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../types.js";

type TokenPayload = {
  sub: string;
  email: string;
  role: Role;
  typ: "access" | "refresh";
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(user: Pick<User, "id" | "email" | "role">): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    typ: "access"
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: "15m", issuer: "cloudpanel" });
}

export async function createRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    }
  });
  return token;
}

export async function rotateRefreshToken(refreshToken: string) {
  const tokenHash = sha256(refreshToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    unauthorized("Refresh token is invalid or expired");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() }
  });

  return issueTokenPair(existing.user);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function issueTokenPair(user: Pick<User, "id" | "email" | "role">) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: await createRefreshToken(user.id)
  };
}

export async function authenticateRequest(request: FastifyRequest): Promise<AuthUser | undefined> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: "cloudpanel" }) as TokenPayload;
    if (decoded.typ !== "access") {
      unauthorized();
    }
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, name: true, role: true, status: true }
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      unauthorized("User is not active");
    }
    request.user = user;
    return user;
  } catch {
    unauthorized();
  }
}

export async function authenticateApiKey(request: FastifyRequest): Promise<AuthUser | undefined> {
  const header = request.headers.authorization;
  if (!header?.startsWith("ApiKey ")) {
    return undefined;
  }
  const key = header.slice("ApiKey ".length);
  const prefix = key.slice(0, 12);
  const hash = sha256(`${key}:${env.API_KEY_PEPPER}`);
  const apiKey = await prisma.aPIKey.findFirst({
    where: {
      prefix,
      keyHash: hash,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    include: { user: true }
  });
  if (!apiKey || apiKey.user.status !== UserStatus.ACTIVE) {
    unauthorized("API key is invalid");
  }
  await prisma.aPIKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() }
  });
  request.apiKeyScopes = apiKey.scopes;
  request.user = {
    id: apiKey.user.id,
    email: apiKey.user.email,
    name: apiKey.user.name,
    role: apiKey.user.role,
    status: apiKey.user.status
  };
  return request.user;
}

export async function requireAuth(request: FastifyRequest): Promise<AuthUser> {
  if (request.user) {
    return request.user;
  }
  return (await authenticateRequest(request)) ?? (await authenticateApiKey(request)) ?? unauthorized();
}

export async function requireRole(request: FastifyRequest, roles: Role[]): Promise<AuthUser> {
  const user = await requireAuth(request);
  if (!roles.includes(user.role)) {
    forbidden("Insufficient role");
  }
  return user;
}

export function canManageUser(actor: AuthUser, targetUserId: string): boolean {
  return actor.role === Role.ADMIN || actor.role === Role.OWNER || actor.id === targetUserId;
}

export function createTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const secret = authenticator.generateSecret();
  return {
    secret,
    otpauthUrl: authenticator.keyuri(email, "CloudPanel", secret)
  };
}

export function verifyTotp(secret: string, token: string): boolean {
  return authenticator.verify({ secret, token });
}

export async function createApiKey(userId: string, name: string, scopes: string[]) {
  const raw = `cp_${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 12);
  const keyHash = sha256(`${raw}:${env.API_KEY_PEPPER}`);
  const apiKey = await prisma.aPIKey.create({
    data: { userId, name, scopes, prefix, keyHash }
  });
  return { apiKey, token: raw };
}
