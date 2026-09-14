/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { NotebookDynamicForms, NotebookFormParams, NotebookFormValue } from '@zeppelin/notebook-core';
import { useEffect, useRef } from 'react';

type ParagraphDynamicFormsProps = Readonly<{
  disabled: boolean;
  forms: NotebookDynamicForms;
  params: NotebookFormParams;
  runOnSelectionChange: boolean;
  onChange: (params: NotebookFormParams, run: boolean) => void;
}>;

const normalizeType = (type: string): string => {
  if (type === 'input') return 'TextBox';
  if (type === 'select') return 'Select';
  if (type === 'checkbox') return 'CheckBox';
  return type;
};

const isStructurallyEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isStructurallyEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every(
      key =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) && isStructurallyEqual(leftRecord[key], rightRecord[key])
    )
  );
};

export const ParagraphDynamicForms = ({
  disabled,
  forms,
  params,
  runOnSelectionChange,
  onChange
}: ParagraphDynamicFormsProps) => {
  const effectiveParams = Object.values(forms).reduce<Record<string, NotebookFormValue>>(
    (current, form) => ({
      ...current,
      [form.name]: Object.prototype.hasOwnProperty.call(current, form.name) ? current[form.name] : form.defaultValue
    }),
    { ...params }
  );
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestParams = useRef(effectiveParams);
  const latestOnChange = useRef(onChange);
  latestParams.current = effectiveParams;
  latestOnChange.current = onChange;
  useEffect(
    () => () => {
      if (runTimer.current) clearTimeout(runTimer.current);
    },
    []
  );
  useEffect(() => {
    if ((disabled || !runOnSelectionChange) && runTimer.current) {
      clearTimeout(runTimer.current);
      runTimer.current = null;
    }
  }, [disabled, runOnSelectionChange]);
  const update = (name: string, value: NotebookFormValue): void => {
    const next = { ...effectiveParams, [name]: value };
    onChange(next, false);
    if (runOnSelectionChange) {
      if (runTimer.current) clearTimeout(runTimer.current);
      runTimer.current = setTimeout(() => {
        runTimer.current = null;
        latestOnChange.current(latestParams.current, true);
      }, 800);
    }
  };

  return (
    <fieldset
      aria-label="Paragraph forms"
      onKeyDown={event => {
        if (event.key === 'Enter' && !disabled && !runOnSelectionChange) onChange(effectiveParams, true);
      }}
    >
      <legend>Paragraph parameters</legend>
      {Object.values(forms).map(form => {
        if (form.hidden) return null;
        const label = form.displayName ?? form.name;
        const value = effectiveParams[form.name];
        const type = normalizeType(form.type);
        if (type === 'Select') {
          const options = form.options ?? [];
          const selectedIndex = options.findIndex(option => isStructurallyEqual(option.value, value));
          return (
            <label key={form.name}>
              {label}
              <select
                aria-label={label}
                disabled={disabled}
                value={selectedIndex < 0 ? '' : String(selectedIndex)}
                onChange={event => {
                  const optionIndex = Number(event.target.value);
                  const selected = options[optionIndex];
                  if (selected) update(form.name, selected.value);
                }}
              >
                {selectedIndex < 0 ? <option value="" hidden /> : null}
                {options.map((option, index) => (
                  <option key={index} value={index}>
                    {option.displayName ?? String(option.value ?? '')}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (type === 'CheckBox') {
          const selected = Array.isArray(value) ? value : [];
          return (
            <fieldset key={form.name}>
              <legend>{label}</legend>
              {(form.options ?? []).map((option, index) => (
                <label key={index}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.some(candidate => isStructurallyEqual(candidate, option.value))}
                    onChange={event =>
                      update(
                        form.name,
                        event.target.checked
                          ? [...selected, option.value]
                          : selected.filter(candidate => !isStructurallyEqual(candidate, option.value))
                      )
                    }
                  />
                  {option.displayName ?? String(option.value ?? '')}
                </label>
              ))}
            </fieldset>
          );
        }
        return (
          <label key={form.name}>
            {label}
            <input
              aria-label={label}
              disabled={disabled}
              type={type === 'Password' ? 'password' : 'text'}
              value={String(value ?? '')}
              onChange={event => update(form.name, event.target.value)}
            />
          </label>
        );
      })}
    </fieldset>
  );
};
