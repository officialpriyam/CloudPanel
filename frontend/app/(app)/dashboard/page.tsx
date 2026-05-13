"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, PageHeader, Panel, Stat } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Vm = { id: string; name: string; status: string; cpuCores: number; ramMb: number; diskGb: number; node?: { name: string }; plan?: { name: string } };

export default function DashboardPage() {
  const [vms, setVms] = useState<Vm[]>([]);
  const [balance, setBalance] = useState<{ credits: number; currency: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Vm[] }>("/vms"),
      apiFetch<{ balance: { credits: number; currency: string } }>("/billing/balance")
    ]).then(([vmData, balanceData]) => {
      setVms(vmData.data);
      setBalance(balanceData.balance);
    }).catch(err => setError((err as Error).message));
  }, []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="VMs, credits, and operational status." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Credit balance" value={balance ? `${(balance.credits / 100).toFixed(2)} ${balance.currency.toUpperCase()}` : "..."} />
        <Stat label="Total VMs" value={vms.length} />
        <Stat label="Running VMs" value={vms.filter(vm => vm.status === "RUNNING").length} />
      </div>
      <div className="mt-6">
        <Panel title="Virtual machines" action={<Link href="/vms/new"><Button>Create VM</Button></Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Name</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Node</th>
                  <th>Resources</th>
                </tr>
              </thead>
              <tbody>
                {vms.map(vm => (
                  <tr key={vm.id} className="border-b border-line">
                    <td className="py-3"><Link className="font-medium text-brand" href={`/vms/${vm.id}`}>{vm.name}</Link></td>
                    <td>{vm.status}</td>
                    <td>{vm.plan?.name ?? "-"}</td>
                    <td>{vm.node?.name ?? "-"}</td>
                    <td>{vm.cpuCores} CPU / {vm.ramMb} MB / {vm.diskGb} GB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
