"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Input, PageHeader, Panel, Select, Stat } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Vm = { id: string; name: string; status: string; cpuCores: number; ramMb: number; diskGb: number; node?: { name: string } };
type FirewallRule = { id: string; action: string; direction: string; protocol: string; port?: string; source?: string; enabled: boolean };

export default function VmDetailPage() {
  const params = useParams<{ id: string }>();
  const [vm, setVm] = useState<Vm | null>(null);
  const [stats, setStats] = useState<Record<string, number | string> | null>(null);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [ruleForm, setRuleForm] = useState({ action: "ACCEPT", direction: "in", protocol: "tcp", port: "22", source: "" });
  const [consoleUrl, setConsoleUrl] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [result, firewall] = await Promise.all([
      apiFetch<{ vm: Vm }>(`/vms/${params.id}`),
      apiFetch<{ data: FirewallRule[] }>(`/vms/${params.id}/firewall`)
    ]);
    setVm(result.vm);
    setRules(firewall.data);
  }, [params.id]);

  useEffect(() => {
    load().catch(err => setError((err as Error).message));
    const timer = setInterval(() => {
      apiFetch<{ stats: Record<string, number | string> }>(`/vms/${params.id}/stats`).then(result => setStats(result.stats)).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [params.id, load]);

  async function action(name: "start" | "stop" | "reboot" | "rebuild") {
    setError("");
    try {
      await apiFetch(`/vms/${params.id}/${name}`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openConsole() {
    const result = await apiFetch<{ console: { websocketUrl: string } }>(`/vms/${params.id}/console`, { method: "POST", body: JSON.stringify({}) });
    setConsoleUrl(result.console.websocketUrl);
  }

  async function addFirewallRule(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch(`/vms/${params.id}/firewall`, {
      method: "POST",
      body: JSON.stringify({ ...ruleForm, port: ruleForm.port || undefined, source: ruleForm.source || undefined, enabled: true })
    });
    await load();
  }

  async function deleteFirewallRule(ruleId: string) {
    await apiFetch(`/vms/${params.id}/firewall/${ruleId}`, { method: "DELETE" });
    await load();
  }

  return (
    <>
      <PageHeader title={vm?.name ?? "VM"} subtitle={vm ? `${vm.status} on ${vm.node?.name ?? "node"}` : "Loading VM"} />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Status" value={vm?.status ?? "..."} />
        <Stat label="CPU" value={vm?.cpuCores ?? "..."} />
        <Stat label="RAM" value={vm ? `${vm.ramMb} MB` : "..."} />
        <Stat label="Disk" value={vm ? `${vm.diskGb} GB` : "..."} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Actions">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => action("start")}>Start</Button>
            <Button variant="secondary" onClick={() => action("stop")}>Stop</Button>
            <Button variant="secondary" onClick={() => action("reboot")}>Reboot</Button>
            <Button variant="secondary" onClick={() => action("rebuild")}>Rebuild</Button>
            <Button variant="secondary" onClick={openConsole}>Console</Button>
          </div>
          {consoleUrl ? <p className="mt-4 break-all text-sm text-slate-600">noVNC websocket: {consoleUrl}</p> : null}
        </Panel>
        <Panel title="Live stats">
          <pre className="overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(stats, null, 2)}</pre>
        </Panel>
        <Panel title="Firewall rules">
          <form onSubmit={addFirewallRule} className="mb-4 grid gap-3 md:grid-cols-5">
            <Select value={ruleForm.action} onChange={event => setRuleForm({ ...ruleForm, action: event.target.value })}><option>ACCEPT</option><option>DROP</option><option>REJECT</option></Select>
            <Select value={ruleForm.direction} onChange={event => setRuleForm({ ...ruleForm, direction: event.target.value })}><option value="in">Inbound</option><option value="out">Outbound</option></Select>
            <Input value={ruleForm.protocol} onChange={event => setRuleForm({ ...ruleForm, protocol: event.target.value })} />
            <Input placeholder="Port" value={ruleForm.port} onChange={event => setRuleForm({ ...ruleForm, port: event.target.value })} />
            <Button type="submit">Add rule</Button>
          </form>
          <div className="space-y-2 text-sm">{rules.map(rule => <div key={rule.id} className="flex items-center justify-between rounded-md border border-line p-3"><span>{rule.direction} {rule.action} {rule.protocol} {rule.port ?? ""} {rule.source ?? ""}</span><Button variant="danger" onClick={() => deleteFirewallRule(rule.id)}>Delete</Button></div>)}</div>
        </Panel>
      </div>
    </>
  );
}
