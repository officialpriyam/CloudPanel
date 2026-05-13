import { Role, UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../services/auth.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "CloudPanel Owner";

if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  process.exit(1);
}

if (password.length < 10) {
  console.error("ADMIN_PASSWORD must be at least 10 characters.");
  process.exit(1);
}

const user = await prisma.user.upsert({
  where: { email },
  create: {
    email,
    name,
    passwordHash: await hashPassword(password),
    role: Role.OWNER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    kycStatus: "APPROVED"
  },
  update: {
    name,
    passwordHash: await hashPassword(password),
    role: Role.OWNER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    kycStatus: "APPROVED"
  }
});

console.log(`Owner admin ready: ${user.email}`);
await prisma.$disconnect();
