/**
 * Self-hosted email sending — Nodemailer against an SMTP server the user
 * controls (no SaaS newsletter provider), per the newsletter phase of
 * `.omc/plans/agent-editions-social-newsletter.md`.
 *
 * Configured entirely via env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
 * `SMTP_PASS`, `NEWSLETTER_FROM_EMAIL`. When any are missing, {@link sendMail}
 * throws a clear `Error` — callers are expected to catch it and flash a
 * warning rather than crash, matching this codebase's existing
 * graceful-degradation pattern for GitHub/Spotify/OpenAI
 * (`web/src/app/admin/editions/generate/route.ts`).
 *
 * `SITE_URL` (optional, defaults to `http://localhost:3000`) is used to build
 * the absolute links (edition summary, per-article, unsubscribe) that go into
 * outbound email — relative links don't make sense outside a browser tab
 * already on the site.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { prisma } from "@/lib/prisma";
import { editionArticles, editionById } from "@/lib/editions";
import { periodLabel } from "@/lib/edition-helpers";

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** Reads and validates the SMTP env vars, or throws a clear error naming what's missing. */
function smtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.NEWSLETTER_FROM_EMAIL;

  const missing = [
    !host && "SMTP_HOST",
    !port && "SMTP_PORT",
    !user && "SMTP_USER",
    !pass && "SMTP_PASS",
    !from && "NEWSLETTER_FROM_EMAIL",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `Email sending is not configured — missing env var(s): ${missing.join(", ")}.`,
    );
  }

  return { host: host!, port: Number(port), user: user!, pass: pass!, from: from! };
}

let cachedTransporter: Transporter | null = null;
let cachedConfigKey: string | null = null;

/** Reused across calls, but rebuilt if the SMTP env vars change (e.g. between test runs). */
function transporterFor(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.user}`;
  if (cachedTransporter && cachedConfigKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  cachedConfigKey = key;
  return cachedTransporter;
}

/**
 * Send one email. Throws when SMTP env vars are missing or the send itself
 * fails — callers catch this and flash a warning rather than crash, the same
 * pattern the existing GitHub/Spotify/OpenAI source fetches use.
 */
export async function sendMail({ to, subject, html }: SendMailOptions): Promise<void> {
  const config = smtpConfig();
  const transporter = transporterFor(config);
  await transporter.sendMail({ from: config.from, to, subject, html });
}

/** Absolute site origin used to build links inside outbound email. */
function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Simple table-based HTML email summarising a published edition. Email
 * clients have poor CSS support, so this deliberately does not reuse any
 * React component or Tailwind class from the site — plain inline styles only.
 */
function editionSummaryHtml(
  edition: { id: number; title: string; cadence: string; periodStart: Date; periodEnd: Date },
  articles: Array<{ id: number; title: string; category: string; content: string }>,
  unsubscribeUrl: string,
): string {
  const origin = siteUrl();
  const editionUrl = `${origin}/edition/${edition.id}`;
  const label = periodLabel(edition);

  const rows = articles
    .map((article) => {
      const excerpt = article.content.replace(/[#*_`>[\]]/g, "").slice(0, 160).trim();
      return `
        <tr>
          <td style="padding:12px 0;border-top:1px solid #ddd;">
            <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#888;">${escapeHtml(article.category)}</div>
            <div style="font-size:16px;font-weight:bold;margin:4px 0;">
              <a href="${origin}/article/${article.id}" style="color:#111;text-decoration:none;">${escapeHtml(article.title)}</a>
            </div>
            <div style="font-size:13px;color:#444;">${escapeHtml(excerpt)}${excerpt.length >= 160 ? "…" : ""}</div>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#111;">
      <tr>
        <td style="text-align:center;padding-bottom:16px;border-bottom:2px solid #111;">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#888;">New Edition</div>
          <div style="font-size:24px;font-weight:bold;margin-top:6px;">${escapeHtml(edition.title)}</div>
          <div style="font-size:13px;color:#666;">${escapeHtml(label)}</div>
        </td>
      </tr>
      <tr>
        <td>
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;padding:20px 0;">
          <a href="${editionUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Read the full edition</a>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#999;">
          You are receiving this because you subscribed to the newsletter.
          <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a>
        </td>
      </tr>
    </table>`;
}

export interface SendNewsletterResult {
  sent: number;
  failed: number;
}

/**
 * Send the edition-summary email to every `confirmed` subscriber.
 *
 * Called from this phase's standalone admin "send newsletter" route
 * (`web/src/app/admin/editions/[editionId]/newsletter/send/route.ts`) today;
 * a later phase wires this same function into the publish flow's
 * post-publish review screen instead of (or in addition to) the standalone
 * route. Each subscriber's send is independently try/caught — one bad
 * address must not abort the batch — and the per-subscriber unsubscribe link
 * is built from that subscriber's own `unsubscribeToken`.
 */
export async function sendNewsletterForEdition(
  editionId: number,
): Promise<SendNewsletterResult> {
  const edition = await editionById(editionId);
  if (!edition) {
    throw new Error(`Edition ${editionId} not found.`);
  }

  const [articles, subscribers] = await Promise.all([
    editionArticles(editionId),
    prisma.subscriber.findMany({ where: { status: "confirmed" } }),
  ]);

  const origin = siteUrl();
  let sent = 0;
  let failed = 0;

  for (const subscriber of subscribers) {
    const unsubscribeUrl = `${origin}/newsletter/unsubscribe/${subscriber.unsubscribeToken}`;
    try {
      await sendMail({
        to: subscriber.email,
        subject: `${edition.title} — new edition published`,
        html: editionSummaryHtml(edition, articles, unsubscribeUrl),
      });
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed };
}
