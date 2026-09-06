/**
 * POST half of the newsletter subscribe form (`/newsletter/subscribe`'s page,
 * and the same-named CTA embedded in `@/components/Footer` on every public
 * page). New in the agent-editions/social/newsletter plan — no Flask
 * equivalent.
 *
 * Double opt-in: creates (or resets) a `pending` `Subscriber` row and emails
 * a confirm link (`/newsletter/confirm/[token]`). Always redirects back to
 * `/newsletter/subscribe` — regardless of which page's footer form posted
 * here — so the flash message has somewhere reliable to render; only that
 * page (and the login page) currently read flash query params.
 *
 * Deliberately returns the *same* generic message whether the address is
 * new, already pending, already confirmed, or previously unsubscribed, so a
 * POST here can't be used to enumerate which addresses are subscribed.
 */

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { describeError, flashRedirect } from "@/lib/flash";
import { sendMail } from "@/lib/mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REDIRECT_PATH = "/newsletter/subscribe";
const GENERIC_MESSAGE =
  "If that address isn't already confirmed, check your inbox for a confirmation link.";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return flashRedirect(request, REDIRECT_PATH, [
      { type: "error", text: "Please enter a valid email address." },
    ]);
  }

  const existing = await prisma.subscriber.findUnique({ where: { email } });

  let confirmToken: string;
  let shouldEmail = true;

  if (!existing) {
    confirmToken = generateToken();
    await prisma.subscriber.create({
      data: {
        email,
        status: "pending",
        confirmToken,
        unsubscribeToken: generateToken(),
      },
    });
  } else if (existing.status === "confirmed") {
    // Already confirmed — no email to send, but the response stays identical
    // to every other branch (see module doc).
    shouldEmail = false;
    confirmToken = existing.confirmToken;
  } else {
    // "pending" or "unsubscribed" — (re)issue a fresh confirm token and resend.
    confirmToken = generateToken();
    await prisma.subscriber.update({
      where: { email },
      data: { status: "pending", confirmToken, confirmedAt: null, unsubscribedAt: null },
    });
  }

  if (shouldEmail) {
    const origin = new URL(request.url).origin;
    const confirmUrl = `${origin}/newsletter/confirm/${confirmToken}`;
    try {
      await sendMail({
        to: email,
        subject: "Confirm your newsletter subscription",
        html: `<p>Thanks for subscribing! Click below to confirm your email address:</p>
<p><a href="${confirmUrl}">${confirmUrl}</a></p>
<p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (error) {
      return flashRedirect(request, REDIRECT_PATH, [
        { type: "warning", text: `Could not send the confirmation email: ${describeError(error)}` },
      ]);
    }
  }

  return flashRedirect(request, REDIRECT_PATH, [{ type: "success", text: GENERIC_MESSAGE }]);
}
