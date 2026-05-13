"use client";

import { useEffect, useState } from "react";
import { Button, Input, PageHeader, Panel, Stat } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Transaction = { id: string; type: string; amount: number; currency: string; description: string; createdAt: string };
type Plan = { id: string; name: string; maxVms: number; cpuCores: number; ramMb: number; diskGb: number; pricePerHour: number; currency: string };

export default function BillingPage() {
  const [balance, setBalance] = useState<{ credits: number; currency: string } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [amount, setAmount] = useState(1000);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ balance: { credits: number; currency: string } }>("/billing/balance").then(result => setBalance(result.balance)).catch(err => setError((err as Error).message));
    apiFetch<{ data: Transaction[] }>("/billing/transactions").then(result => setTransactions(result.data)).catch(() => undefined);
    apiFetch<{ data: Plan[] }>("/plans").then(result => setPlans(result.data)).catch(() => undefined);
  }, []);

  async function topup(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch<{ checkoutUrl: string }>("/billing/topup", {
        method: "POST",
        body: JSON.stringify({ amount, currency: balance?.currency ?? "usd", gateway: "STRIPE" })
      });
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function upgrade(planId: string) {
    await apiFetch(`/plans/${planId}/upgrade`, { method: "POST", body: JSON.stringify({}) });
  }

  return (
    <>
      <PageHeader title="Billing" subtitle="Credits, top-ups, invoices, and usage history." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Stat label="Balance" value={balance ? `${(balance.credits / 100).toFixed(2)} ${balance.currency.toUpperCase()}` : "..."} />
          <Panel title="Top up credits">
            <form onSubmit={topup} className="space-y-3">
              <Input type="number" min={100} value={amount} onChange={event => setAmount(Number(event.target.value))} />
              <Button type="submit" className="w-full">Pay with Stripe</Button>
            </form>
          </Panel>
          <Panel title="Plan upgrades">
            <div className="space-y-3 text-sm">
              {plans.map(plan => <div key={plan.id} className="rounded-md border border-line p-3"><div className="font-medium">{plan.name}</div><div className="text-slate-600">{plan.maxVms} VMs / {plan.cpuCores} CPU / {plan.ramMb} MB / {plan.diskGb} GB</div><Button className="mt-3" variant="secondary" onClick={() => upgrade(plan.id)}>Upgrade</Button></div>)}
            </div>
          </Panel>
        </div>
        <Panel title="Transactions">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase text-slate-500">
              <tr><th className="py-2">Type</th><th>Amount</th><th>Description</th><th>Date</th></tr>
            </thead>
            <tbody>
              {transactions.map(item => (
                <tr key={item.id} className="border-b border-line">
                  <td className="py-3">{item.type}</td>
                  <td>{(item.amount / 100).toFixed(2)} {item.currency.toUpperCase()}</td>
                  <td>{item.description}</td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
