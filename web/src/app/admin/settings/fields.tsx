/**
 * Shared form-field renderers for a `SettingFieldSpec` (`./field-specs.ts`) +
 * its resolved `SettingDisplayInfo` (`./setting-display.ts`) — used by both
 * `/admin/settings`'s per-category cards (`./page.tsx`) and the `/setup`
 * onboarding wizard's per-category steps (`src/app/setup/`), so both render
 * identical inputs (including the masked "leave blank to keep current value"
 * secret convention) rather than duplicating this markup.
 */

import type { SettingDisplayInfo } from "./setting-display";
import { sourceLabel } from "./setting-display";
import type { SettingFieldSpec } from "./field-specs";

function StatusNote({ info, hasDefault = false }: { info: SettingDisplayInfo; hasDefault?: boolean }) {
  return (
    <p
      className={`text-[10px] font-sans mt-1 ${
        info.configured ? "text-stone-500" : "text-amber-700"
      }`}
    >
      {sourceLabel(info, hasDefault)}
    </p>
  );
}

export function Field({
  label,
  name,
  info,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  info: SettingDisplayInfo;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
        {label}
      </label>
      <input
        type={type}
        name={name}
        defaultValue={info.value}
        placeholder={placeholder}
        className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
      />
      <StatusNote info={info} hasDefault={Boolean(placeholder) && !info.configured} />
    </div>
  );
}

export function SecretField({
  label,
  name,
  info,
}: {
  label: string;
  name: string;
  info: SettingDisplayInfo;
}) {
  return (
    <div>
      <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
        {label}
      </label>
      <input
        type="password"
        name={name}
        placeholder={info.configured ? "•••••••• (leave blank to keep current value)" : "Not set"}
        autoComplete="off"
        className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
      />
      <StatusNote info={info} />
    </div>
  );
}

/** Renders one `SettingFieldSpec` as a `Field` or `SecretField`, looked up from `values` by `settingKey`. */
export function CategoryFormFields({
  fields,
  values,
}: {
  fields: SettingFieldSpec[];
  values: Record<string, SettingDisplayInfo>;
}) {
  return (
    <>
      {fields.map((field) => {
        const info = values[field.settingKey];
        return field.secret ? (
          <SecretField key={field.formKey} label={field.label} name={field.formKey} info={info} />
        ) : (
          <Field
            key={field.formKey}
            label={field.label}
            name={field.formKey}
            info={info}
            placeholder={field.placeholder}
          />
        );
      })}
    </>
  );
}

/** Resolves `settingDisplay()` for every field of `fields`, keyed by `settingKey`. */
export async function resolveFieldValues(
  fields: SettingFieldSpec[],
  settingDisplay: (
    key: string,
    opts: { secret?: boolean; default?: string },
  ) => Promise<SettingDisplayInfo>,
): Promise<Record<string, SettingDisplayInfo>> {
  const infos = await Promise.all(
    fields.map((field) => settingDisplay(field.settingKey, { secret: field.secret, default: field.default })),
  );
  const values: Record<string, SettingDisplayInfo> = {};
  fields.forEach((field, index) => {
    values[field.settingKey] = infos[index];
  });
  return values;
}
