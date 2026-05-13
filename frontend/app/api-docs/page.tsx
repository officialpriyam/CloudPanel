"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

export default function ApiDocsPage() {
  const [docs, setDocs] = useState<{ title: string; version: string; auth: string; routes: string[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ title: string; version: string; auth: string; routes: string[] }>("/docs").then(setDocs).catch(err => setError((err as Error).message));
  }, []);

  return (
    <AppShell>
      <PageHeader title="API documentation" subtitle="CloudPanel REST API v1." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <Panel title={docs?.title ?? "CloudPanel API"}>
        <p className="mb-4 text-sm text-slate-600">{docs?.auth}</p>
        <div className="grid gap-2 text-sm">
          {docs?.routes.map(route => <code key={route} className="rounded-md bg-slate-100 px-3 py-2">{route}</code>)}
        </div>
      </Panel>
    </AppShell>
  );
}
