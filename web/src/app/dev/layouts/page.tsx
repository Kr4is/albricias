import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import LayoutFixture from "@/components/dev/LayoutFixture";

/** Development only: every layout on made-up articles (see `lib/dev-fixture.ts`). */
export default function LayoutsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <NewspaperShell endpoint="app">
      <LayoutFixture />
    </NewspaperShell>
  );
}
