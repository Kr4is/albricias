"use client";

/**
 * The AI category's provider picker + its per-provider fields, as one
 * interactive unit instead of `CategoryFormFields`' flat list — see that
 * function's doc comment for why a `"provider-picker"` field hands off here.
 *
 * Renders the picker as segmented buttons (a styled radio group, not a
 * `<select>`) and shows only the selected provider's fields. Every other
 * provider's inputs stay in the DOM but `disabled`, so `FormData` omits them
 * on submit — `saveFields()` already treats an absent field as "no change"
 * (its documented behavior for a blank field), so switching providers here
 * never clobbers credentials saved for a provider you're not looking at.
 */

import { useState } from "react";
import { Field, SecretField } from "./fields";
import type { SettingDisplayInfo } from "./setting-display-types";
import type { SettingFieldSpec } from "./field-specs";

export default function AiProviderFields({
  pickerField,
  groupedFields,
  values,
  muted = false,
}: {
  pickerField: SettingFieldSpec;
  groupedFields: SettingFieldSpec[];
  values: Record<string, SettingDisplayInfo>;
  muted?: boolean;
}) {
  const options = pickerField.options ?? [];
  const savedValue = values[pickerField.settingKey]?.value;
  const [selected, setSelected] = useState(
    savedValue || pickerField.default || options[0]?.value,
  );

  return (
    <div>
      <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
        {pickerField.label}
      </label>
      <div className="flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label={pickerField.label}>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <label
              key={option.value}
              className={`px-3 py-1.5 text-xs font-sans font-bold uppercase tracking-widest border-2 cursor-pointer transition-colors ${
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-stone-300 text-stone-600 hover:border-ink"
              }`}
            >
              <input
                type="radio"
                name={pickerField.formKey}
                value={option.value}
                checked={active}
                onChange={() => setSelected(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>

      <div className="space-y-4">
        {groupedFields.map((field) => {
          const info = values[field.settingKey];
          const disabled = field.providerGroup !== selected;
          return (
            <div key={field.formKey} hidden={disabled}>
              {field.secret ? (
                <SecretField
                  label={field.label}
                  name={field.formKey}
                  info={info}
                  muted={muted}
                  disabled={disabled}
                />
              ) : (
                <Field
                  label={field.label}
                  name={field.formKey}
                  info={info}
                  placeholder={field.placeholder}
                  muted={muted}
                  disabled={disabled}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
