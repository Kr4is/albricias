/**
 * Renders an edition in one of the six broadsheet layouts (`IssueV1` …
 * `IssueV6`), chosen by `layout`.
 */

import IssueV1 from "@/components/issue/IssueV1";
import IssueV2 from "@/components/issue/IssueV2";
import IssueV3 from "@/components/issue/IssueV3";
import IssueV4 from "@/components/issue/IssueV4";
import IssueV5 from "@/components/issue/IssueV5";
import IssueV6 from "@/components/issue/IssueV6";
import type { LayoutIndex } from "@/lib/layout";
import type { IssueLayoutProps } from "@/components/issue/types";

const LAYOUTS = {
  1: IssueV1,
  2: IssueV2,
  3: IssueV3,
  4: IssueV4,
  5: IssueV5,
  6: IssueV6,
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
