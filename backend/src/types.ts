import type { Role, UserStatus } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    apiKeyScopes?: string[];
  }
}
