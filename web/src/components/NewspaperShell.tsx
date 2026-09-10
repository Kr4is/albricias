/**
 * The broadsheet page frame from `app/templates/base.html:50-57` — the
 * `max-w-[1400px]` sheet, the header partial and `<main>`.
 *
 * base.html could read `issue`/`article` from Jinja globals; every page here
 * passes them explicitly so the masthead can show the right volume line and
 * weather.
 */

import Header from "@/components/Header";
import type { HeaderProps } from "@/components/Header";
import Footer from "@/components/Footer";
import FlashBfcacheRefresh from "@/components/FlashBfcacheRefresh";

export type NewspaperShellProps = HeaderProps & {
  children: React.ReactNode;
};

export default function NewspaperShell({
  children,
  ...header
}: NewspaperShellProps) {
  // Skip the footer CTA on admin pages and on the subscribe page itself,
  // where the same form is already the page's main content.
  const hideFooter =
    header.endpoint.startsWith("admin") || header.endpoint === "public.newsletter_subscribe";

  return (
    <div className="max-w-[1400px] mx-auto bg-paper shadow-2xl min-h-screen flex flex-col border-x border-stone-200 print:shadow-none print:border-none print:max-w-none">
      <Header {...header} />
      <main className="flex-grow px-6 sm:px-8 lg:px-10 py-6 print:px-0">
        {children}
      </main>
      {!hideFooter && <Footer />}
      <FlashBfcacheRefresh />
      <script
        // Site-wide form-submit intercepts, both delegated on `document` so
        // they also cover forms that render after this script runs (e.g. a
        // list re-rendered by router.refresh()) — not a querySelectorAll
        // snapshot taken once at load.
        dangerouslySetInnerHTML={{
          __html: `
            // Confirmation gate for any form marked data-confirm="...".
            // Registered before the data-loading-submit handler below, and
            // that handler also checks event.defaultPrevented, so cancelling
            // this confirm() never leaves the submit button disabled as if
            // the submit had gone through.
            document.addEventListener('submit', function (event) {
              var form = event.target;
              if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-confirm')) return;
              if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
            });

            // Site-wide opt-in loading state for slow full-page-navigation form
            // submits (AI generation and similar). A form marked
            // \`data-loading-submit\` gets its submit button(s) disabled and
            // relabeled on submit — inert on every other form, since the
            // browser's own navigation covers the rest.
            document.addEventListener('submit', function (event) {
              // A submit cancelled by the data-confirm gate above must not
              // still be treated as "in flight" here.
              if (event.defaultPrevented) return;
              var form = event.target;
              if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-loading-submit')) return;
              // Only the button that was actually clicked (a form can have
              // several submit buttons with different formAction overrides,
              // e.g. Save vs. Regenerate) — leave the others alone.
              var btn = event.submitter;
              if (!(btn instanceof HTMLButtonElement)) return;
              btn.disabled = true;
              var loadingText = btn.getAttribute('data-loading-text');
              if (loadingText) btn.textContent = loadingText;
              btn.classList.add('opacity-60', 'cursor-wait');
            });
          `,
        }}
      />
    </div>
  );
}
