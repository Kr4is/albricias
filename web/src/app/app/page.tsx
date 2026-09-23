import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";
import AppClient from "@/components/AppClient";

export const metadata: Metadata = { title: "Generate Your Edition - Albricias" };

export default function AppPage() {
  return (
    <NewspaperShell endpoint="app">
      <AppClient />
    </NewspaperShell>
  );
}
