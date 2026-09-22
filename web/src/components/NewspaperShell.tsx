/**
 * The broadsheet page frame from `app/templates/base.html:50-57` — the
 * `max-w-[1400px]` sheet, the header partial and `<main>`.
 *
 * base.html could read `issue`/`article` from Jinja globals; every page here
 * passes them explicitly so the masthead can show the right volume line and
 * weather.
 */

import Script from "next/script";
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
      <Script
        id="newspaper-shell-form-intercepts"
        strategy="afterInteractive"
        // Site-wide form-submit intercepts, both delegated on `document` so
        // they also cover forms that render after this script runs (e.g. a
        // list re-rendered by router.refresh()) — not a querySelectorAll
        // snapshot taken once at load. `next/script` (rather than a raw
        // `<script>`) is what actually runs this on a client-side
        // navigation, not just a full page load — see the React DEV warning
        // a raw `<script>` produces here otherwise.
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
            // \`data-loading-submit\` gets its submit button(s) disabled,
            // relabeled, and given a spinning icon on submit — inert on every
            // other form, since the browser's own navigation covers the rest.
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
              if (loadingText) {
                // A button with an icon child marks its text with
                // data-loading-label so only that span gets replaced —
                // textContent on the whole button would destroy the icon.
                // Falls back to the whole button for a plain-text one.
                var label = btn.querySelector('[data-loading-label]');
                if (label) label.textContent = loadingText;
                else btn.textContent = loadingText;
              }
              btn.classList.add('opacity-60', 'cursor-wait');
              // Prepended, not textContent-based, so it never destroys an
              // icon+label button that didn't set data-loading-text.
              var spinner = document.createElement('span');
              spinner.className = 'material-icons text-sm animate-spin align-middle mr-1.5';
              spinner.textContent = 'autorenew';
              spinner.setAttribute('aria-hidden', 'true');
              btn.prepend(spinner);

              // Live elapsed-time counter — some of these (AI generation
              // against a slow self-hosted model) run for minutes, and a
              // static spinner with no change for that long reads as frozen.
              // Appended last, after every above mutation, so it's never
              // wiped by the data-loading-text replacement above it.
              var timer = document.createElement('span');
              timer.className = 'ml-1.5 font-normal opacity-80 tabular-nums';
              timer.setAttribute('aria-live', 'polite');
              btn.appendChild(timer);
              var startedAt = Date.now();
              var tick = function () {
                var s = Math.round((Date.now() - startedAt) / 1000);
                timer.textContent = '(' + (s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's') + ')';
              };
              tick();
              setInterval(tick, 1000);
            });

            // Remember every persistable <details> (Disclosure, data-persist-key
            // set) open/closed across full page reloads — native <details>
            // forgets its \`open\` state on every navigation, which otherwise
            // loses e.g. which admin-dashboard row was expanded the moment a
            // form on the page (like "process this day") submits and reloads
            // it. The \`toggle\` event on <details> doesn't bubble, so this
            // listens on the capturing phase to catch it via delegation anyway.
            document.addEventListener('toggle', function (event) {
              var el = event.target;
              if (!(el instanceof HTMLDetailsElement) || !el.dataset.persistKey) return;
              try {
                localStorage.setItem('disclosure:' + el.dataset.persistKey, el.open ? '1' : '0');
              } catch (e) {}
            }, true);
            document.querySelectorAll('details[data-persist-key]').forEach(function (el) {
              try {
                var saved = localStorage.getItem('disclosure:' + el.dataset.persistKey);
                if (saved === '1') el.open = true;
                else if (saved === '0') el.open = false;
              } catch (e) {}
            });
          `,
        }}
      />
    </div>
  );
}
