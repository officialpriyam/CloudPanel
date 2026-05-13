import Link from "next/link";
import type React from "react";
import clsx from "clsx";
import { Activity, CloudUpload, CreditCard, HelpCircle, KeyRound, LayoutDashboard, Server, Settings, Shield } from "lucide-react";

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const { className, variant = "primary", ...rest } = props;
  return (
    <button
      {...rest}
      className={clsx(
        "focus-ring inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" && "bg-brand text-white hover:bg-teal-800",
        variant === "secondary" && "border border-line bg-white text-ink hover:bg-slate-50",
        variant === "danger" && "bg-red-700 text-white hover:bg-red-800",
        className
      )}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx("focus-ring h-10 w-full rounded-md border border-line bg-white px-3 text-sm", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx("focus-ring h-10 w-full rounded-md border border-line bg-white px-3 text-sm", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx("focus-ring min-h-28 w-full rounded-md border border-line bg-white px-3 py-2 text-sm", props.className)} />;
}

export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-normal text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vms/new", label: "New VM", icon: Server },
  { href: "/deploy", label: "Deploy", icon: CloudUpload },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/support", label: "Support", icon: HelpCircle },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/api-docs", label: "API Docs", icon: KeyRound },
  { href: "/admin", label: "Admin", icon: Shield }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-panel">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white p-4 md:block">
        <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold">
          <Activity className="h-5 w-5 text-brand" />
          CloudPanel
        </Link>
        <nav className="mt-8 space-y-1">
          {nav.map(item => (
            <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="md:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
    </header>
  );
}
