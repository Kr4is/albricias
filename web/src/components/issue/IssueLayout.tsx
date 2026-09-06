/**
 * Picks the broadsheet variant for an edition, replacing Flask's
 * `template = f"issue_v{layout_index(edition)}.html"`
 * (`app/routes/public.py:72` and `:195`).
 *
 * Phase 3's admin preview route can render this same component with
 * `isPreview` set to get the toolbar, exactly as `admin.py` did by rendering
 * the same `issue_v*.html` templates.
 */

import IssueV1 from "@/components/issue/IssueV1";
import IssueV2 from "@/components/issue/IssueV2";
import IssueV3 from "@/components/issue/IssueV3";
import IssueV4 from "@/components/issue/IssueV4";
import IssueV5 from "@/components/issue/IssueV5";
import type { LayoutIndex } from "@/lib/layout";
import type { IssueLayoutProps } from "@/components/issue/types";

const LAYOUTS = {
  1: IssueV1,
  2: IssueV2,
  3: IssueV3,
  4: IssueV4,
  5: IssueV5,
} as const satisfies Record<
  LayoutIndex,
  (props: IssueLayoutProps) => React.ReactElement
>;

export type IssueLayoutComponentProps = IssueLayoutProps & {
  layout: LayoutIndex;
};

export default function IssueLayout({
  layout,
  ...props
}: IssueLayoutComponentProps) {
  const Layout = LAYOUTS[layout];
  return <Layout {...props} />;
}
