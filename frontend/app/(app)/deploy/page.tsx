"use client";

import { useEffect, useState } from "react";
import { Button, Input, PageHeader, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Project = {
  id: string;
  name: string;
  provider: string;
  repoUrl?: string;
  branch: string;
  status: string;
  deployments: Array<{ id: string; status: string; log?: string; createdAt: string }>;
};

export default function DeployPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState({ name: "", provider: "GIT", repoUrl: "", branch: "main", buildCommand: "npm run build", outputDir: "dist" });
  const [error, setError] = useState("");

  async function load() {
    const result = await apiFetch<{ data: Project[] }>("/deploy/projects");
    setProjects(result.data);
  }

  useEffect(() => {
    load().catch(err => setError((err as Error).message));
  }, []);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    await apiFetch("/deploy/projects", {
      method: "POST",
      body: JSON.stringify({ ...form, repoUrl: form.repoUrl || undefined })
    });
    setForm({ name: "", provider: "GIT", repoUrl: "", branch: "main", buildCommand: "npm run build", outputDir: "dist" });
    await load();
  }

  async function deploy(projectId: string) {
    await apiFetch(`/deploy/projects/${projectId}/deploy`, { method: "POST", body: JSON.stringify({}) });
    await load();
  }

  return (
    <>
      <PageHeader title="Deploy" subtitle="AWS-style deployment projects with Git, artifact, and SFTP targets." />
      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Panel title="Create project">
          <form onSubmit={createProject} className="grid gap-3">
            <Input placeholder="Project name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required />
            <Select value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value })}><option>GIT</option><option>SFTP</option><option>MANUAL</option></Select>
            <Input placeholder="Repository URL" value={form.repoUrl} onChange={event => setForm({ ...form, repoUrl: event.target.value })} />
            <Input placeholder="Branch" value={form.branch} onChange={event => setForm({ ...form, branch: event.target.value })} />
            <Input placeholder="Build command" value={form.buildCommand} onChange={event => setForm({ ...form, buildCommand: event.target.value })} />
            <Input placeholder="Output directory" value={form.outputDir} onChange={event => setForm({ ...form, outputDir: event.target.value })} />
            <Button type="submit">Create project</Button>
          </form>
        </Panel>
        <Panel title="Projects">
          <div className="space-y-3">
            {projects.map(project => <article key={project.id} className="rounded-md border border-line p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-medium">{project.name}</h3><p className="text-sm text-slate-600">{project.provider} / {project.branch} / {project.status}</p></div><Button onClick={() => deploy(project.id)}>Deploy</Button></div><pre className="mt-3 overflow-auto rounded-md bg-slate-100 p-3 text-xs">{project.deployments[0]?.log ?? "No deployments yet."}</pre></article>)}
          </div>
        </Panel>
      </div>
    </>
  );
}
