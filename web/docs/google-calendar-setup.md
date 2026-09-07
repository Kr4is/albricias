# Google Calendar setup

Manual, one-time steps to let Albricias connect to your own Google account
for the Calendar stats ranking and meeting-notes assisted articles (Phase F
of the google-calendar-alexandria-sources plan). This is a personal,
single-user integration — you'll keep the OAuth consent screen in **Testing**
mode, which skips Google's app-verification process entirely.

Written against the Google Cloud Console flow current as of 2026. Google
occasionally reshuffles console navigation; if a menu label below doesn't
match what you see, search the console for the capitalized term (e.g.
"Credentials", "OAuth consent screen").

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   sign in with the Google account whose calendar you want to connect.
2. Click the project picker at the top of the page → **New Project**.
3. Give it a name (e.g. "Albricias") and create it. No billing account is
   required for this integration.

## 2. Enable the Calendar API and Docs API

With your new project selected:

1. Go to **APIs & Services → Library**.
2. Search for **Google Calendar API**, open it, and click **Enable**.
3. Search for **Google Docs API**, open it, and click **Enable**.

Both are needed: the Calendar API lists calendars and fetches events; the
Docs API fetches a meeting's Gemini "Take notes for me" notes document when
one is attached.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** as the user type (Internal requires a Google
   Workspace organization; External works for a personal `@gmail.com`
   account too, and Testing mode keeps it private).
3. Fill in the required app information (app name, your email as the support
   contact and developer contact). None of this is shown to anyone but you.
4. On the **Scopes** step, add:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/documents.readonly`
5. On the **Test users** step, add your own Google account's email address.
   **This is the step that lets you skip verification** — an app in Testing
   mode only works for accounts explicitly listed here, so Google doesn't
   require a review. If you ever want a second person to connect their own
   calendar, you'd need to add them here too (still no verification needed,
   up to 100 test users) or submit the app for verification to go public.
6. Save. Leave the app in **Testing** — do not click "Publish app".

## 4. Create an OAuth 2.0 Client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name it anything (e.g. "Albricias web").
5. Under **Authorized redirect URIs**, add the callback URL matching your
   deployment and the redirect URI you'll enter at `/admin/settings`:
   - Local dev: `http://localhost:3000/admin/calendar/callback`
   - Production: `https://your-domain.example/admin/calendar/callback`
6. Create it. Copy the **Client ID** and **Client secret** shown.

## 5. Configure Albricias

Enter these at **`/admin/settings`** (Google Calendar card) — there is no
`.env` option for these, saving takes effect immediately, no restart needed:

- **Client ID**: the client ID from step 4
- **Client secret**: the client secret from step 4
- **Redirect URI**: `http://localhost:3000/admin/calendar/callback` (or your
  production equivalent)

Then visit `/admin/calendar` (or click "Manage" next to "Google Calendar" on
`/admin/editions`) and click **Connect Google Calendar**. You'll be sent to
Google's consent screen, asked to approve the two read-only scopes, and
redirected back — the app immediately fetches your calendar list.

## 6. Set each calendar's mode

Every calendar you have access to shows up on `/admin/calendar`, **defaulting
to "Off"** — completely ignored. This is a deliberate privacy default: a
personal or medical calendar can stay Off (or "Stats only") forever. Only
flip a calendar to:

- **Stats only** — feeds the automatic "Calendar" ranking (event count,
  hours, busiest day, day-of-week distribution). Event titles/descriptions
  are never read for a Stats-only calendar — this is enforced in code, not
  just hidden in the UI (see `web/src/lib/sources/google.ts`'s
  `fetchCalendarEventStats` and `web/src/lib/rankings/calendar.ts`).
- **Articles** — makes its events browsable, one at a time, on the assisted
  article-generation form, for a manual "meeting → article/podcast" pick.
- **Both** — does both of the above.

## Troubleshooting

- **"Access blocked: this app's request is invalid"** or **"Error 403:
  access_denied"** — your Google account isn't listed as a test user (step
  3.5), or the redirect URI saved at `/admin/settings` doesn't exactly match
  one of the "Authorized redirect URIs" on the OAuth client (step 4.5).
- **No refresh token after reconnecting** — Albricias always requests
  `prompt=consent`, so Google should re-issue one on every connect. If you
  revoked the app's access from your
  [Google Account permissions page](https://myaccount.google.com/permissions)
  and see stale-token errors, disconnect in `/admin/calendar` and reconnect.
- **A calendar you expect isn't listed** — click "Sync Calendars" on
  `/admin/calendar` to re-fetch the list from Google.
