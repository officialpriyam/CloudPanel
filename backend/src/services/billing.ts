import { GatewayProvider, TransactionStatus, TransactionType, VMStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { calculateHourlyCharge } from "../lib/money.js";
import { queues } from "../workers/queues.js";

export async function creditUser(input: {
  userId: string;
  amount: number;
  currency: string;
  gateway?: GatewayProvider;
  gatewayRef?: string;
  description: string;
}) {
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    const balanceBefore = user.credits;
    const balanceAfter = balanceBefore + input.amount;
    const updatedUser = await tx.user.update({
      where: { id: input.userId },
      data: { credits: balanceAfter, currency: input.currency }
    });
    const transaction = await tx.transaction.create({
      data: {
        userId: input.userId,
        type: TransactionType.TOPUP,
        status: TransactionStatus.SUCCEEDED,
        amount: input.amount,
        currency: input.currency,
        gateway: input.gateway,
        gatewayRef: input.gatewayRef,
        description: input.description
      }
    });
    await tx.creditLog.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        reason: input.description,
        reference: transaction.id
      }
    });
    return { user: updatedUser, transaction };
  });
}

export async function adjustCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  reference?: string;
}) {
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    const balanceBefore = user.credits;
    const balanceAfter = balanceBefore + input.amount;
    await tx.user.update({ where: { id: user.id }, data: { credits: balanceAfter } });
    await tx.creditLog.create({
      data: {
        userId: user.id,
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        reason: input.reason,
        reference: input.reference
      }
    });
    await tx.transaction.create({
      data: {
        userId: user.id,
        type: input.amount >= 0 ? TransactionType.ADJUSTMENT : TransactionType.HOURLY_USAGE,
        status: TransactionStatus.SUCCEEDED,
        amount: input.amount,
        currency: user.currency,
        description: input.reason,
        gatewayRef: input.reference
      }
    });
    return balanceAfter;
  });
}

export async function billRunningVmsOnce() {
  const vms = await prisma.vM.findMany({
    where: { status: VMStatus.RUNNING, deletedAt: null },
    include: { user: true }
  });

  const results: Array<{ vmId: string; charged: number; suspended: boolean }> = [];
  for (const vm of vms) {
    const lockKey = `billing:vm:${vm.id}`;
    const locked = await redis.set(lockKey, "1", "EX", 3500, "NX");
    if (!locked) {
      continue;
    }
    const charged = calculateHourlyCharge(vm.hourlyPrice);
    const balance = await prisma.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: vm.userId } });
      const before = user.credits;
      const after = before - charged;
      await tx.user.update({ where: { id: vm.userId }, data: { credits: after } });
      const transaction = await tx.transaction.create({
        data: {
          userId: vm.userId,
          vmId: vm.id,
          type: TransactionType.HOURLY_USAGE,
          status: TransactionStatus.SUCCEEDED,
          amount: -charged,
          currency: vm.currency,
          description: `Hourly usage for ${vm.name}`
        }
      });
      await tx.creditLog.create({
        data: {
          userId: vm.userId,
          amount: -charged,
          balanceBefore: before,
          balanceAfter: after,
          reason: `Hourly usage for ${vm.name}`,
          reference: transaction.id
        }
      });
      await tx.vM.update({ where: { id: vm.id }, data: { lastBilledAt: new Date() } });
      return after;
    });
    const suspended = balance < 0;
    if (suspended) {
      await queues.vm.add("suspend-low-credit", { vmId: vm.id }, { attempts: 5, backoff: { type: "exponential", delay: 10_000 } });
    }
    results.push({ vmId: vm.id, charged, suspended });
  }
  return results;
}
