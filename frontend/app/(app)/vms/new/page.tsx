"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, PageHeader, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Plan = { id: string; name: string; cpuCores: number; ramMb: number; diskGb: number; pricePerHour: number; currency: string };
type NodeItem = { id: string; name: string; status: string };

export default function NewVmPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [form, setForm] = useState({ name: "", planId: "", nodeId: "", bridge: "vmbr0" });
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ data: Plan[] }>("/plans").then(result => {
      setPlans(result.data);
      setForm(current => ({ ...current, planId: result.data[0]?.id ?? "" }));
    }).catch(err => setError((err as Error).message));
    apiFetch<{ data: NodeItem[] }>("/nodes").then(result => {
      setNodes(result.data.filter(node => node.status === "ACTIVE"));
      setForm(current => ({ ...current, nodeId: result.data[0]?.id ?? "" }));
    }).catch(() => setNodes([]));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch<{ vm: { id: string } }>("/vms", {
        method: "POST",
        body: JSON.stringify(form)
      });
      router.push(`/vms/${result.vm.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Create VM" subtitle="Select a Proxmox node, plan, and network bridge." />
      <Panel title="VM wizard">
        <form className="grid max-w-2xl gap-4" onSubmit={submit}>
          {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <label className="text-sm font-medium">Name<Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="web-01" required /></label>
          <label className="text-sm font-medium">Plan<Select value={form.planId} onChange={event => setForm({ ...form, planId: event.target.value })}>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} - {(plan.pricePerHour / 100).toFixed(2)} {plan.currency}/hr</option>)}</Select></label>
          <label className="text-sm font-medium">Node<Select value={form.nodeId} onChange={event => setForm({ ...form, nodeId: event.target.value })}>{nodes.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</Select></label>
          <label className="text-sm font-medium">Bridge<Input value={form.bridge} onChange={event => setForm({ ...form, bridge: event.target.value })} required /></label>
          <Button type="submit" disabled={!form.planId || !form.nodeId}>Create VM</Button>
        </form>
      </Panel>
    </>
  );
}
