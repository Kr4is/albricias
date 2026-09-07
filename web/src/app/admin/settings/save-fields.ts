/**
 * Shared save helper for every `/admin/settings/<category>/route.ts` handler:
 * writes each non-blank submitted field via `setSetting()`
 * (`@/lib/config/settings.ts`). A blank submitted value is always treated as
 * "no change" — it is never written — so re-submitting a form with some
 * fields left blank (the documented pattern for secrets, but applied
 * uniformly here) never overwrites an existing saved value with an empty
 * DB row.
 */

import { setSetting } from "@/lib/config/settings";

export interface FieldSpec {
  /** `FormData` field name. */
  formKey: string;
  /** `Setting.key` to write. */
  settingKey: string;
  encrypted?: boolean;
}

export async function saveFields(form: FormData, fields: FieldSpec[]): Promise<void> {
  for (const field of fields) {
    const raw = form.get(field.formKey);
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    await setSetting(field.settingKey, value, { encrypted: field.encrypted ?? false });
  }
}
