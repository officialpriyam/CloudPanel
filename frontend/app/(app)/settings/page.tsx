"use client";

import { useEffect, useState } from "react";
import { Button, Input, PageHeader, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; createdAt: string };

export default function SettingsPage() {
  const [me, setMe] = useState<{ email: string; name: string; role: string; totpEnabled: boolean } | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keyName, setKeyName] = useState("automation");
  const [newToken, setNewToken] = useState("");
  const [totpUrl, setTotpUrl] = useState("");
  const [totp, setTotp] = useState("");
  const [kycStatus, setKycStatus] = useState("NOT_SUBMITTED");
  const [kycForm, setKycForm] = useState({ legalName: "", country: "", documentType: "passport", documentNumber: "", documentUrl: "" });
  const [error, setError] = useState("");

  async function load() {
    const [meResult, keyResult, kycResult] = await Promise.all([
      apiFetch<{ user: { email: string; name: string; role: string; totpEnabled: boolean } }>("/auth/me"),
      apiFetch<{ data: ApiKey[] }>("/api-keys"),
      apiFetch<{ status: string }>("/kyc")
    ]);
    setMe(meResult.user);
    setKeys(keyResult.data);
    setKycStatus(kycResult.status);
  }

  useEffect(() => {
    load().catch(err => setError((err as Error).message));
  }, []);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    const result = await apiFetch<{ token: string }>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: keyName, scopes: ["vms:read", "vms:write", "billing:read"] })
    });
    setNewToken(result.token);
    await load();
  }

  async function setupTotp() {
    const result = await apiFetch<{ otpauthUrl: string }>("/auth/2fa/setup", { method: "POST", body: JSON.stringify({}) });
    setTotpUrl(result.otpauthUrl);
  }

  async function verifyTotp(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ token: totp }) });
    await load();
  }

  async function submitKyc(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/kyc", {
      method: "POST",
      body: JSON.stringify({ ...kycForm, documentUrl: kycForm.documentUrl || undefined })
    });
    await load();
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, 2FA, and API keys." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile">
          <dl className="space-y-2 text-sm">
            <div><dt className="font-medium">Name</dt><dd>{me?.name}</dd></div>
            <div><dt className="font-medium">Email</dt><dd>{me?.email}</dd></div>
            <div><dt className="font-medium">Role</dt><dd>{me?.role}</dd></div>
          </dl>
        </Panel>
        <Panel title="Two-factor authentication">
          <div className="space-y-3 text-sm">
            <p>Status: {me?.totpEnabled ? "Enabled" : "Disabled"}</p>
            <Button variant="secondary" onClick={setupTotp}>Generate TOTP secret</Button>
            {totpUrl ? <p className="break-all rounded-md bg-slate-100 p-3">{totpUrl}</p> : null}
            <form className="flex gap-2" onSubmit={verifyTotp}>
              <Input placeholder="Token" value={totp} onChange={event => setTotp(event.target.value)} />
              <Button type="submit">Verify</Button>
            </form>
          </div>
        </Panel>
        <Panel title="API keys">
          <form onSubmit={createKey} className="mb-4 flex gap-2">
            <Input value={keyName} onChange={event => setKeyName(event.target.value)} />
            <Button type="submit">Create</Button>
          </form>
          {newToken ? <div className="mb-4 break-all rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">{newToken}</div> : null}
          <div className="space-y-2 text-sm">
            {keys.map(key => <div key={key.id} className="rounded-md border border-line p-3">{key.name} / {key.prefix}</div>)}
          </div>
        </Panel>
        <Panel title="KYC verification">
          <p className="mb-4 text-sm text-slate-600">Status: {kycStatus}</p>
          <form onSubmit={submitKyc} className="grid gap-3">
            <Input placeholder="Legal name" value={kycForm.legalName} onChange={event => setKycForm({ ...kycForm, legalName: event.target.value })} required />
            <Input placeholder="Country" value={kycForm.country} onChange={event => setKycForm({ ...kycForm, country: event.target.value })} required />
            <Input placeholder="Document type" value={kycForm.documentType} onChange={event => setKycForm({ ...kycForm, documentType: event.target.value })} required />
            <Input placeholder="Document number" value={kycForm.documentNumber} onChange={event => setKycForm({ ...kycForm, documentNumber: event.target.value })} required />
            <Input placeholder="Document URL" value={kycForm.documentUrl} onChange={event => setKycForm({ ...kycForm, documentUrl: event.target.value })} />
            <Button type="submit">Submit KYC</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
