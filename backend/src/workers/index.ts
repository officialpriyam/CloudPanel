import { Worker } from "bullmq";
import { VMStatus } from "@prisma/client";
import { redis } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import { billRunningVmsOnce } from "../services/billing.js";
import { ProxmoxService } from "../services/proxmox.js";
import { sendEmail, sendOpsAlert } from "../services/notifications.js";
import { createInvoicePdf } from "../services/invoices.js";
import { scheduleRepeatableJobs } from "./queues.js";

await scheduleRepeatableJobs();

new Worker(
  "billing",
  async job => {
    if (job.name === "hourly-billing") {
      return billRunningVmsOnce();
    }
    return null;
  },
  { connection: redis }
);

new Worker(
  "vm",
  async job => {
    if (job.name === "suspend-low-credit") {
      const { vmId } = job.data as { vmId: string };
      const vm = await prisma.vM.findUniqueOrThrow({ where: { id: vmId }, include: { node: true, user: true } });
      if (vm.status === VMStatus.RUNNING) {
        await new ProxmoxService(vm.node).stopVM(vm);
      }
      await prisma.vM.update({
        where: { id: vm.id },
        data: { status: VMStatus.SUSPENDED, suspendedAt: new Date() }
      });
      await sendEmail({
        to: vm.user.email,
        subject: "CloudPanel VM suspended",
        html: `<p>Your VM ${vm.name} was suspended because credits are below zero.</p>`
      });
      return { suspended: vm.id };
    }
    return null;
  },
  { connection: redis }
);

new Worker(
  "notifications",
  async job => {
    if (job.name === "email") {
      return sendEmail(job.data as { to: string; subject: string; html: string; text?: string });
    }
    if (job.name === "ops-alert") {
      return sendOpsAlert(String((job.data as { message: string }).message));
    }
    return null;
  },
  { connection: redis }
);

new Worker(
  "invoices",
  async job => {
    if (job.name === "generate-pdf") {
      const buffer = await createInvoicePdf((job.data as { invoiceId: string }).invoiceId);
      return { bytes: buffer.byteLength };
    }
    return null;
  },
  { connection: redis }
);

new Worker(
  "health",
  async job => {
    if (job.name === "node-health") {
      const nodes = await prisma.node.findMany();
      for (const node of nodes) {
        try {
          const stats = await new ProxmoxService(node).getNodeStats();
          await prisma.node.update({
            where: { id: node.id },
            data: {
              status: "ACTIVE",
              cpuUsage: stats.data.cpu,
              ramUsage: stats.data.memory.used / stats.data.memory.total,
              diskUsage: stats.data.rootfs.used / stats.data.rootfs.total
            }
          });
        } catch (error) {
          await prisma.node.update({ where: { id: node.id }, data: { status: "UNREACHABLE" } });
          await sendOpsAlert(`CloudPanel node ${node.name} is unreachable: ${(error as Error).message}`);
        }
      }
    }
    return null;
  },
  { connection: redis }
);

new Worker(
  "deployments",
  async job => {
    if (job.name === "run-deployment") {
      const { deploymentId } = job.data as { deploymentId: string };
      const deployment = await prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: "BUILDING", log: "Deployment picked up by CloudPanel worker.\n" },
        include: { project: true }
      });
      const log = [
        "Deployment picked up by CloudPanel worker.",
        `Project: ${deployment.project.name}`,
        `Provider: ${deployment.project.provider}`,
        deployment.project.repoUrl ? `Repository: ${deployment.project.repoUrl}` : "Repository: not configured",
        deployment.project.sftpEndpointId ? "SFTP target configured." : "SFTP target not configured.",
        "Control-plane deployment record completed."
      ].join("\n");
      await prisma.deploymentProject.update({
        where: { id: deployment.projectId },
        data: { status: "DEPLOYED", lastDeployAt: new Date() }
      });
      return prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: "DEPLOYED", log, completedAt: new Date() }
      });
    }
    return null;
  },
  { connection: redis }
);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
