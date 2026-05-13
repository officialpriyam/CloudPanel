"use client";

import { useEffect, useState } from "react";
import { Button, Input, PageHeader, Panel, Select, Stat } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Metrics = { totalUsers: number; totalVms: number; activeVms: number; revenueAll: number; openTickets: number };
type NodeItem = { id: string; name: string; host: string; status: string; cpuUsage?: number };
type UserItem = { id: string; email: string; name: string; status: string; credits: number; role: string; kycStatus?: string };
type PlanItem = { id: string; name: string; slug: string; cpuCores: number; ramMb: number; diskGb: number; maxVms: number; pricePerHour: number; currency: string; active: boolean };
type PlatformSettings = {
  allowRegistration: boolean;
  requireEmailVerification: boolean;
  forceUser2fa: boolean;
  kycRequiredForVmCreate: boolean;
  supportMode: string;
  supportExternalUrl: string;
  paymenterEnabled: boolean;
  whmcsEnabled: boolean;
};
type KycItem = { id: string; legalName: string; country: string; status: string; user: { email: string } };
type GatewayItem = { id: string; provider: string; name: string; active: boolean };

export default function AdminPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [kyc, setKyc] = useState<KycItem[]>([]);
  const [gateways, setGateways] = useState<GatewayItem[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [nodeForm, setNodeForm] = useState({ name: "", cluster: "default", host: "", port: 8006, tokenId: "", tokenSecret: "" });
  const [planForm, setPlanForm] = useState({ name: "", slug: "", cpuCores: 1, ramMb: 1024, diskGb: 20, maxVms: 1, pricePerHour: 2, currency: "usd", active: true });
  const [gatewayForm, setGatewayForm] = useState({ provider: "STRIPE", name: "default", active: true, apiKey: "", webhookSecret: "" });
  const [creditForm, setCreditForm] = useState({ userId: "", amount: 0, reason: "Manual credit adjustment" });
  const [error, setError] = useState("");

  async function load() {
    const [dash, userResult, nodeResult, planResult, settingsResult, kycResult, gatewayResult] = await Promise.all([
      apiFetch<{ metrics: Metrics; nodes: NodeItem[] }>("/admin/dashboard"),
      apiFetch<{ data: UserItem[] }>("/admin/users"),
      apiFetch<{ data: NodeItem[] }>("/admin/nodes"),
      apiFetch<{ data: PlanItem[] }>("/admin/plans"),
      apiFetch<{ platform: PlatformSettings }>("/admin/settings"),
      apiFetch<{ data: KycItem[] }>("/admin/kyc"),
      apiFetch<{ data: GatewayItem[] }>("/admin/gateways")
    ]);
    setMetrics(dash.metrics);
    setNodes(nodeResult.data);
    setUsers(userResult.data);
    setPlans(planResult.data);
    setSettings(settingsResult.platform);
    setKyc(kycResult.data);
    setGateways(gatewayResult.data);
    setCreditForm(current => ({ ...current, userId: userResult.data[0]?.id ?? "" }));
  }

  useEffect(() => {
    load().catch(err => setError((err as Error).message));
  }, []);

  async function addNode(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/admin/nodes", { method: "POST", body: JSON.stringify(nodeForm) });
    setNodeForm({ name: "", cluster: "default", host: "", port: 8006, tokenId: "", tokenSecret: "" });
    await load();
  }

  async function adjustCredits(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/admin/billing/credits", { method: "POST", body: JSON.stringify(creditForm) });
    await load();
  }

  async function updateUser(userId: string, patch: Partial<UserItem>) {
    await apiFetch(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
    await load();
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    await apiFetch("/admin/platform-settings", { method: "PUT", body: JSON.stringify(settings) });
    await load();
  }

  async function savePlan(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/admin/plans", { method: "POST", body: JSON.stringify(planForm) });
    setPlanForm({ name: "", slug: "", cpuCores: 1, ramMb: 1024, diskGb: 20, maxVms: 1, pricePerHour: 2, currency: "usd", active: true });
    await load();
  }

  async function reviewKyc(id: string, status: "APPROVED" | "REJECTED") {
    await apiFetch(`/admin/kyc/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await load();
  }

  async function saveGateway(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/admin/gateways", {
      method: "POST",
      body: JSON.stringify({
        provider: gatewayForm.provider,
        name: gatewayForm.name,
        active: gatewayForm.active,
        config: { apiKey: gatewayForm.apiKey },
        webhookSecret: gatewayForm.webhookSecret || undefined
      })
    });
    setGatewayForm({ provider: "STRIPE", name: "default", active: true, apiKey: "", webhookSecret: "" });
    await load();
  }

  return (
    <>
      <PageHeader title="Admin" subtitle="Users, VMs, nodes, revenue, tickets, gateways, and settings." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid gap-4 md:grid-cols-5">
        <Stat label="Users" value={metrics?.totalUsers ?? "..."} />
        <Stat label="VMs" value={metrics?.totalVms ?? "..."} />
        <Stat label="Active VMs" value={metrics?.activeVms ?? "..."} />
        <Stat label="Revenue" value={metrics ? `$${(metrics.revenueAll / 100).toFixed(2)}` : "..."} />
        <Stat label="Open tickets" value={metrics?.openTickets ?? "..."} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Platform controls">
          {settings ? (
            <form onSubmit={saveSettings} className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.allowRegistration} onChange={event => setSettings({ ...settings, allowRegistration: event.target.checked })} /> Allow registration</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.requireEmailVerification} onChange={event => setSettings({ ...settings, requireEmailVerification: event.target.checked })} /> Require email verification</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.forceUser2fa} onChange={event => setSettings({ ...settings, forceUser2fa: event.target.checked })} /> Force user 2FA</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.kycRequiredForVmCreate} onChange={event => setSettings({ ...settings, kycRequiredForVmCreate: event.target.checked })} /> Require KYC for VM create</label>
              <label className="text-sm font-medium">Support mode<Select value={settings.supportMode} onChange={event => setSettings({ ...settings, supportMode: event.target.value })}><option>TICKETS</option><option>KNOWLEDGE_BASE</option><option>EXTERNAL_LINK</option><option>BOTH</option></Select></label>
              <label className="text-sm font-medium">External support URL<Input value={settings.supportExternalUrl} onChange={event => setSettings({ ...settings, supportExternalUrl: event.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.paymenterEnabled} onChange={event => setSettings({ ...settings, paymenterEnabled: event.target.checked })} /> Enable Paymenter</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.whmcsEnabled} onChange={event => setSettings({ ...settings, whmcsEnabled: event.target.checked })} /> Enable WHMCS</label>
              <Button type="submit">Save controls</Button>
            </form>
          ) : null}
        </Panel>
        <Panel title="Nodes">
          <form onSubmit={addNode} className="mb-4 grid gap-3 md:grid-cols-2">
            <Input placeholder="Name" value={nodeForm.name} onChange={event => setNodeForm({ ...nodeForm, name: event.target.value })} required />
            <Input placeholder="Host" value={nodeForm.host} onChange={event => setNodeForm({ ...nodeForm, host: event.target.value })} required />
            <Input placeholder="Token ID" value={nodeForm.tokenId} onChange={event => setNodeForm({ ...nodeForm, tokenId: event.target.value })} required />
            <Input placeholder="Token secret" type="password" value={nodeForm.tokenSecret} onChange={event => setNodeForm({ ...nodeForm, tokenSecret: event.target.value })} required />
            <Button type="submit">Add node</Button>
          </form>
          <div className="space-y-2 text-sm">
            {nodes.map(node => <div key={node.id} className="rounded-md border border-line p-3">{node.name} / {node.host} / {node.status}</div>)}
          </div>
        </Panel>
        <Panel title="Users">
          <form onSubmit={adjustCredits} className="mb-4 grid gap-3 md:grid-cols-3">
            <Select value={creditForm.userId} onChange={event => setCreditForm({ ...creditForm, userId: event.target.value })}>
              {users.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}
            </Select>
            <Input type="number" value={creditForm.amount} onChange={event => setCreditForm({ ...creditForm, amount: Number(event.target.value) })} />
            <Button type="submit">Adjust credits</Button>
          </form>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase text-slate-500"><tr><th className="py-2">User</th><th>Status</th><th>KYC</th><th>Credits</th><th>Actions</th></tr></thead>
            <tbody>{users.map(user => <tr key={user.id} className="border-b border-line"><td className="py-3">{user.email}</td><td>{user.status}</td><td>{user.kycStatus ?? "-"}</td><td>{(user.credits / 100).toFixed(2)}</td><td className="space-x-2"><Button variant="secondary" onClick={() => updateUser(user.id, { status: "ACTIVE" })}>Activate</Button><Button variant="danger" onClick={() => updateUser(user.id, { status: "SUSPENDED" })}>Ban</Button></td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Plans and limits">
          <form onSubmit={savePlan} className="mb-4 grid gap-3 md:grid-cols-4">
            <Input placeholder="Name" value={planForm.name} onChange={event => setPlanForm({ ...planForm, name: event.target.value })} required />
            <Input placeholder="slug" value={planForm.slug} onChange={event => setPlanForm({ ...planForm, slug: event.target.value })} required />
            <Input type="number" min={1} value={planForm.cpuCores} onChange={event => setPlanForm({ ...planForm, cpuCores: Number(event.target.value) })} />
            <Input type="number" min={256} value={planForm.ramMb} onChange={event => setPlanForm({ ...planForm, ramMb: Number(event.target.value) })} />
            <Input type="number" min={5} value={planForm.diskGb} onChange={event => setPlanForm({ ...planForm, diskGb: Number(event.target.value) })} />
            <Input type="number" min={0} value={planForm.maxVms} onChange={event => setPlanForm({ ...planForm, maxVms: Number(event.target.value) })} />
            <Input type="number" min={0} value={planForm.pricePerHour} onChange={event => setPlanForm({ ...planForm, pricePerHour: Number(event.target.value) })} />
            <Button type="submit">Save plan</Button>
          </form>
          <div className="space-y-2 text-sm">{plans.map(plan => <div key={plan.id} className="rounded-md border border-line p-3">{plan.name}: {plan.cpuCores} CPU / {plan.ramMb} MB / {plan.diskGb} GB / {plan.maxVms} VMs / {(plan.pricePerHour / 100).toFixed(2)} {plan.currency}/hr</div>)}</div>
        </Panel>
        <Panel title="KYC review">
          <div className="space-y-2 text-sm">
            {kyc.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3"><span>{item.user.email} / {item.legalName} / {item.country} / {item.status}</span><span className="space-x-2"><Button variant="secondary" onClick={() => reviewKyc(item.id, "APPROVED")}>Approve</Button><Button variant="danger" onClick={() => reviewKyc(item.id, "REJECTED")}>Reject</Button></span></div>)}
          </div>
        </Panel>
        <Panel title="Payment gateways">
          <form onSubmit={saveGateway} className="mb-4 grid gap-3 md:grid-cols-2">
            <Select value={gatewayForm.provider} onChange={event => setGatewayForm({ ...gatewayForm, provider: event.target.value })}><option>STRIPE</option><option>RAZORPAY</option><option>PAYPAL</option><option>MANUAL</option></Select>
            <Input placeholder="Name" value={gatewayForm.name} onChange={event => setGatewayForm({ ...gatewayForm, name: event.target.value })} />
            <Input placeholder="API key / config secret" value={gatewayForm.apiKey} onChange={event => setGatewayForm({ ...gatewayForm, apiKey: event.target.value })} />
            <Input placeholder="Webhook secret" value={gatewayForm.webhookSecret} onChange={event => setGatewayForm({ ...gatewayForm, webhookSecret: event.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gatewayForm.active} onChange={event => setGatewayForm({ ...gatewayForm, active: event.target.checked })} /> Active</label>
            <Button type="submit">Save gateway</Button>
          </form>
          <div className="space-y-2 text-sm">{gateways.map(gateway => <div key={gateway.id} className="rounded-md border border-line p-3">{gateway.provider} / {gateway.name} / {gateway.active ? "active" : "disabled"}</div>)}</div>
        </Panel>
      </div>
    </>
  );
}
