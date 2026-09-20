/**
 * "Test connection" for the Email settings category — a real SMTP handshake
 * via `verifySmtpConnection()` (`@/lib/mail`, Nodemailer's `verify()`), no
 * message sent. Throws the same "missing setting(s)" error `sendMail` would
 * if the category isn't fully configured yet.
 */

import type { NextRequest } from "next/server";
import { verifySmtpConnection } from "@/lib/mail";
import { describeError, flashRedirect } from "@/lib/flash";

export async function POST(request: NextRequest) {
  try {
    const { host } = await verifySmtpConnection();
    return flashRedirect(request, "/admin/settings", [
      { type: "success", text: `SMTP connection to ${host} works.` },
    ]);
  } catch (error) {
    return flashRedirect(request, "/admin/settings", [
      { type: "error", text: `Email connection test failed: ${describeError(error)}` },
    ]);
  }
}
