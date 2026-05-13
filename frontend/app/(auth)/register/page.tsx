"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Panel } from "@/components/ui";
import { apiFetch, setTokens } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch<{ tokens: { accessToken: string; refreshToken: string } }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setTokens(result.tokens);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-panel px-4">
      <Panel title="Create CloudPanel account">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <Input placeholder="Name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required />
          <Input type="email" placeholder="Email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required />
          <Input type="password" placeholder="Password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required minLength={10} />
          <Button className="w-full" type="submit">Create account</Button>
          <Link className="block text-sm text-brand" href="/login">Already have an account</Link>
        </form>
      </Panel>
    </main>
  );
}
