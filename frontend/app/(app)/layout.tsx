import { AppShell } from "@/components/ui";

export default function ApplicationLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
