"use client";

import { useEffect, useState } from "react";
import { Button, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Ticket = { id: string; subject: string; status: string; priority: string; messages: Array<{ id: string; body: string; createdAt: string }> };
type SupportConfig = { supportMode: string; supportExternalUrl?: string };
type Article = { id: string; slug: string; title: string; body: string; category?: { title: string } };

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [form, setForm] = useState({ subject: "", priority: "NORMAL", body: "" });
  const [error, setError] = useState("");

  async function load() {
    const [configResult, kbResult] = await Promise.all([
      apiFetch<SupportConfig>("/support/config"),
      apiFetch<{ data: Article[] }>("/knowledge-base/articles")
    ]);
    setConfig(configResult);
    setArticles(kbResult.data);
    if (configResult.supportMode === "TICKETS" || configResult.supportMode === "BOTH") {
      const result = await apiFetch<{ data: Ticket[] }>("/tickets");
      setTickets(result.data);
    }
  }

  useEffect(() => {
    load().catch(err => setError((err as Error).message));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/tickets", { method: "POST", body: JSON.stringify(form) });
      setForm({ subject: "", priority: "NORMAL", body: "" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Support" subtitle="Tickets, knowledge base, and external helpdesk routing." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      {config?.supportExternalUrl && (config.supportMode === "EXTERNAL_LINK" || config.supportMode === "BOTH") ? <a className="mb-4 inline-flex text-sm font-medium text-brand" href={config.supportExternalUrl}>Open external support portal</a> : null}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {(config?.supportMode === "TICKETS" || config?.supportMode === "BOTH" || !config) ? <Panel title="Create ticket">
          <form className="space-y-3" onSubmit={submit}>
            <Input placeholder="Subject" value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} required />
            <Select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>
              <option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option>
            </Select>
            <Textarea placeholder="Message" value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} required />
            <Button type="submit">Open ticket</Button>
          </form>
        </Panel> : <Panel title="Tickets disabled"><p className="text-sm text-slate-600">Ticket creation is disabled by the admin support mode.</p></Panel>}
        <Panel title="Tickets">
          <div className="space-y-3">
            {tickets.map(ticket => (
              <article key={ticket.id} className="rounded-md border border-line p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">{ticket.subject}</h3>
                  <span className="text-xs text-slate-500">{ticket.status} / {ticket.priority}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{ticket.messages[0]?.body}</p>
              </article>
            ))}
          </div>
        </Panel>
        {(config?.supportMode === "KNOWLEDGE_BASE" || config?.supportMode === "BOTH" || !config) ? <Panel title="Knowledge base">
          <div className="space-y-3">
            {articles.map(article => <article key={article.id} className="rounded-md border border-line p-4"><h3 className="font-medium">{article.title}</h3><p className="mt-1 text-xs text-slate-500">{article.category?.title}</p><p className="mt-2 text-sm text-slate-600">{article.body.slice(0, 240)}</p></article>)}
          </div>
        </Panel> : null}
      </div>
    </>
  );
}
