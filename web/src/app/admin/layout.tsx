/**
 * Layout for the whole `/admin` subtree — introduced only to host the
 * `@modal` parallel slot (see `@modal/default.tsx` and
 * `@modal/(.)settings/page.tsx`). Purely structural: every admin page still
 * wraps itself in its own `<NewspaperShell>`, this layout doesn't add any
 * chrome of its own, just renders the normal page next to whatever the
 * modal slot resolves to (usually nothing).
 */

export default function AdminLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
