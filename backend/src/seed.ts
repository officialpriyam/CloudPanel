import { prisma } from "./lib/prisma.js";

await prisma.plan.upsert({
  where: { slug: "starter-1" },
  create: {
    slug: "starter-1",
    name: "Starter 1",
    description: "1 vCPU, 1 GB RAM, 20 GB disk",
    cpuCores: 1,
    ramMb: 1024,
    diskGb: 20,
    bandwidthGb: 1024,
    pricePerHour: 2,
    currency: "usd"
  },
  update: {}
});

await prisma.plan.upsert({
  where: { slug: "standard-2" },
  create: {
    slug: "standard-2",
    name: "Standard 2",
    description: "2 vCPU, 4 GB RAM, 60 GB disk",
    cpuCores: 2,
    ramMb: 4096,
    diskGb: 60,
    bandwidthGb: 2048,
    pricePerHour: 8,
    currency: "usd"
  },
  update: {}
});

await prisma.emailTemplate.upsert({
  where: { key: "low-credit-warning" },
  create: {
    key: "low-credit-warning",
    subject: "CloudPanel low credit warning",
    body: "<p>Your CloudPanel credits are running low.</p>"
  },
  update: {}
});

await prisma.$disconnect();
