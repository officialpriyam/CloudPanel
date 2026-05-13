"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Panel } from "@/components/ui";
import { API_URL, apiFetch, setTokens } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const accessToken = search.get("accessToken");
    const refreshToken = search.get("refreshToken");
    const verifyToken = search.get("verifyToken");
    if (accessToken && refreshToken) {
      setTokens({ accessToken, refreshToken });
      router.replace("/dashboard");
    }
    if (verifyToken) {
      apiFetch("/auth/email-verification/verify", {
        method: "POST",
        body: JSON.stringify({ token: verifyToken })
      }).then(() => setError("Email verified. You can sign in now.")).catch(err => setError((err as Error).message));
    }
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch<{ tokens: { accessToken: string; refreshToken: string } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, totp: totp || undefined })
      });
      setTokens(result.tokens);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-panel px-4">
      <Panel title="Sign in to CloudPanel">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <Input type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} required />
          <Input placeholder="2FA token" value={totp} onChange={event => setTotp(event.target.value)} />
          <Button className="w-full" type="submit">Sign in</Button>
          <div className="flex justify-between text-sm">
            <Link className="text-brand" href="/register">Create account</Link>
            <div className="flex gap-3">
              <a className="text-brand" href={`${API_URL}/auth/oauth/google/start`}>Google</a>
              <a className="text-brand" href={`${API_URL}/auth/oauth/github/start`}>GitHub</a>
            </div>
          </div>
        </form>
      </Panel>
    </main>
  );
}
