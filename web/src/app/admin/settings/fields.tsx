/**
 * Shared form-field renderers for a `SettingFieldSpec` (`./field-specs.ts`) +
 * its resolved `SettingDisplayInfo` (`./setting-display.ts`) — used by both
 * `/admin/settings`'s per-category cards (`./page.tsx`) and the `/setup`
 * onboarding wizard's per-category steps (`src/app/setup/`), so both render
 * identical inputs (including the masked "leave blank to keep current value"
 * secret convention) rather than duplicating this markup.
 */

import type { SettingDisplayInfo } from "./setting-display-types";
import { sourceLabel } from "./setting-display-types";
import type { SettingFieldSpec } from "./field-specs";
import AiProviderFields from "./ai-provider-fields";

/**
 * `muted` flattens the "not configured" amber to the same neutral gray as
 * "using saved setting" — used on `/setup`, where every field is still
 * blank by definition and the amber otherwise reads as a wall of warnings
 * before the admin has had a chance to fill in anything. `/admin/settings`
 * (where amber legitimately flags drift) leaves it unset.
 */
export function StatusNote({
  info,
  hasDefault = false,
  muted = false,
}: {
  info: SettingDisplayInfo;
  hasDefault?: boolean;
  muted?: boolean;
}) {
  return (
    <p
      className={`text-[10px] font-sans mt-1 ${
        info.configured || muted ? "text-stone-500" : "text-amber-700"
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
  muted = false,
  disabled = false,
}: {
  label: string;
  name: string;
  info: SettingDisplayInfo;
  placeholder?: string;
  type?: string;
  muted?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
        className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans disabled:opacity-50"
      />
      <StatusNote info={info} hasDefault={Boolean(placeholder) && !info.configured} muted={muted} />
    </div>
  );
}

export function SelectField({
  label,
  name,
  info,
  options,
  muted = false,
  disabled = false,
}: {
  label: string;
  name: string;
  info: SettingDisplayInfo;
  options: { value: string; label: string }[];
  muted?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
        {label}
      </label>
      <select
        name={name}
        defaultValue={info.value}
        disabled={disabled}
        className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <StatusNote info={info} hasDefault={!info.configured} muted={muted} />
    </div>
  );
}

export function SecretField({
  label,
  name,
  info,
  muted = false,
  disabled = false,
}: {
  label: string;
  name: string;
  info: SettingDisplayInfo;
  muted?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
        className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans disabled:opacity-50"
      />
      <StatusNote info={info} muted={muted} />
    </div>
  );
}

/**
 * Renders one `SettingFieldSpec` as a `Field`/`SecretField`/`SelectField`,
 * looked up from `values` by `settingKey`. A `"provider-picker"` field hands
 * the whole category off to `AiProviderFields` instead — it and every field
 * carrying a `providerGroup` are a single interactive unit, not a flat list.
 *
 * `muted` is `/setup`'s "everything's blank on a fresh instance, don't show
 * amber warnings for it" mode — see `StatusNote`. `/admin/settings` omits it.
 */
export function CategoryFormFields({
  fields,
  values,
  muted = false,
}: {
  fields: SettingFieldSpec[];
  values: Record<string, SettingDisplayInfo>;
  muted?: boolean;
}) {
  const pickerField = fields.find((field) => field.type === "provider-picker");
  if (pickerField) {
    return (
      <AiProviderFields
        pickerField={pickerField}
        groupedFields={fields.filter((field) => field !== pickerField)}
        values={values}
        muted={muted}
      />
    );
  }

  return (
    <>
      {fields.map((field) => {
        const info = values[field.settingKey];
        if (field.type === "select") {
          return (
            <SelectField
              key={field.formKey}
              label={field.label}
              name={field.formKey}
              info={info}
              options={field.options ?? []}
              muted={muted}
            />
          );
        }
        return field.secret ? (
          <SecretField key={field.formKey} label={field.label} name={field.formKey} info={info} muted={muted} />
        ) : (
          <Field
            key={field.formKey}
            label={field.label}
            name={field.formKey}
            info={info}
            placeholder={field.placeholder}
            muted={muted}
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
