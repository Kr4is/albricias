/**
 * AES-256-GCM encryption for `Setting.value` rows stored at rest (see
 * `src/lib/config/settings.ts`, the one place credentials get read/written).
 *
 * The key lives in a file *outside* the SQLite database, so a copy of just
 * the `.db` file is never enough to decrypt anything — see
 * `.omc/plans/web-based-settings.md`, "Encrypted-at-rest secrets".
 *
 * Key location: derived from `DATABASE_URL`, not hardcoded, so it works
 * identically in both deployments this app supports:
 *   - Local dev: `DATABASE_URL="file:./dev.db"` → `better-sqlite3` (via
 *     `@prisma/adapter-better-sqlite3`, which just strips the `file:` prefix
 *     and hands the rest straight to `better-sqlite3`'s `Database`
 *     constructor — see `node_modules/@prisma/adapter-better-sqlite3/dist/index.js`)
 *     resolves `./dev.db` relative to `process.cwd()`, i.e. `web/dev.db`
 *     when run the normal way (`npm run dev`/`build`/`start` from `web/`).
 *     The key file ends up at `web/settings.key`, a sibling of `dev.db` —
 *     see the root `.gitignore` note below for why this is safe to commit
 *     against.
 *   - Docker: `docker-compose.yml` sets `DATABASE_URL=file:/app/instance/albricias.db`,
 *     an absolute path under the `./instance` bind mount. The key file ends
 *     up at `/app/instance/settings.key`, i.e. `<repo>/instance/settings.key`
 *     on the host — persisted the same way the DB is, and outside the git
 *     repo's tracked tree (`instance/` is gitignored at the repo root).
 *
 * `settings.key` is chmod'd 600 on creation. Losing this file makes every
 * encrypted `Setting` row permanently unreadable — back it up alongside the
 * database. `decrypt()` throws (does not silently return garbage) on a
 * missing/rotated key or corrupted ciphertext.
 *
 * Serialization format: `"<iv>:<authTag>:<ciphertext>"`, each segment
 * base64-encoded (GCM's 96-bit IV and 128-bit auth tag, per Node's
 * documented recommended usage of `createCipheriv`/`createDecipheriv`).
 *
 * The loaded key is cached on `globalThis`, mirroring `src/lib/prisma.ts`'s
 * `PrismaClient` caching, so Next.js dev-mode hot reloads reuse the same key
 * buffer instead of re-reading (or, on a very first request, re-generating)
 * the key file on every recompile.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // 96 bits, GCM's recommended IV length
const KEY_FILE_NAME = "settings.key";

/**
 * Directory the key file lives in: the same directory as the SQLite file
 * `DATABASE_URL` points at. Mirrors exactly how
 * `@prisma/adapter-better-sqlite3` resolves that same URL (strip the
 * `file:` prefix, hand the remainder to `better-sqlite3`, which resolves a
 * relative path against `process.cwd()`).
 */
function keyFilePath(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set; cannot locate the settings encryption key.");
  }
  const rawPath = url.replace(/^file:/, "");
  // Genuinely dynamic (depends on the runtime DATABASE_URL env var, not a
  // static project-relative path) — opt out of Turbopack's build-time
  // filesystem-access tracing per its own suggested fix, rather than let it
  // pull the whole project into the Proxy/Middleware bundle.
  const dbPath = resolve(/* turbopackIgnore: true */ process.cwd(), rawPath);
  return resolve(dirname(dbPath), KEY_FILE_NAME);
}

function loadOrCreateKey(): Buffer {
  const path = keyFilePath();
  if (existsSync(path)) {
    return readFileSync(path);
  }
  const key = randomBytes(KEY_LENGTH_BYTES);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key, { mode: 0o600 });
  // Belt-and-suspenders: writeFileSync's `mode` is masked by the process
  // umask, so an explicit chmod guarantees 600 regardless of umask.
  chmodSync(path, 0o600);
  return key;
}

const globalForSettingsKey = globalThis as unknown as {
  settingsEncryptionKey: Buffer | undefined;
};

function getKey(): Buffer {
  if (!globalForSettingsKey.settingsEncryptionKey) {
    globalForSettingsKey.settingsEncryptionKey = loadOrCreateKey();
  }
  return globalForSettingsKey.settingsEncryptionKey;
}

/** Encrypt `plaintext`, returning `"<iv>:<authTag>:<ciphertext>"` (base64 segments). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a string produced by {@link encrypt}. Throws on a malformed
 * value, a wrong/rotated key, or tampered ciphertext (GCM's authentication
 * tag check fails) — callers should let this propagate as a clear error
 * rather than swallow it, per the "fail with a clear error on a decrypt
 * failure" risk mitigation in the settings plan.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted setting value: expected "<iv>:<authTag>:<ciphertext>".');
  }
  const [ivB64, authTagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}
