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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ParagraphDynamicForms } from './ParagraphDynamicForms';

describe('ParagraphDynamicForms', () => {
  it('round-trips select values by option index without collapsing their types', () => {
    const onChange = vi.fn();
    render(
      <ParagraphDynamicForms
        disabled={false}
        forms={{
          choice: {
            name: 'choice',
            displayName: 'Choice',
            type: 'Select',
            hidden: false,
            defaultValue: 1,
            options: [
              { value: 1, displayName: 'Number' },
              { value: '1', displayName: 'String' },
              { value: null, displayName: 'Null' }
            ]
          }
        }}
        params={{ choice: 1 }}
        runOnSelectionChange={false}
        onChange={onChange}
      />
    );

    const select = screen.getByRole('combobox', { name: 'Choice' }) as HTMLSelectElement;
    expect(select.value).toBe('0');

    fireEvent.change(select, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith({ choice: '1' }, false);

    fireEvent.change(select, { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({ choice: null }, false);
  });

  it('restores and removes structurally equal checkbox object values', () => {
    const onChange = vi.fn();
    render(
      <ParagraphDynamicForms
        disabled={false}
        forms={{
          choices: {
            name: 'choices',
            displayName: 'Choices',
            type: 'CheckBox',
            hidden: false,
            defaultValue: [],
            options: [{ value: { id: 'object-choice' }, displayName: 'Object choice' }]
          }
        }}
        params={{ choices: [{ id: 'object-choice' }] }}
        runOnSelectionChange={false}
        onChange={onChange}
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Object choice' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ choices: [] }, false);
  });

  it('runs with the latest server parameters after the selection debounce', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const forms = {
      country: {
        name: 'country',
        displayName: 'Country',
        type: 'Select',
        hidden: false,
        defaultValue: 'kr',
        options: [
          { value: 'kr', displayName: 'Korea' },
          { value: 'us', displayName: 'United States' }
        ]
      },
      limit: { name: 'limit', displayName: 'Limit', type: 'TextBox', hidden: false, defaultValue: '10' }
    };
    const { rerender } = render(
      <ParagraphDynamicForms
        disabled={false}
        forms={forms}
        params={{ country: 'kr', limit: '10' }}
        runOnSelectionChange
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: '1' } });
    rerender(
      <ParagraphDynamicForms
        disabled={false}
        forms={forms}
        params={{ country: 'us', limit: '20' }}
        runOnSelectionChange
        onChange={onChange}
      />
    );
    vi.advanceTimersByTime(800);

    expect(onChange).toHaveBeenLastCalledWith({ country: 'us', limit: '20' }, true);
    vi.useRealTimers();
  });

  it('cancels a pending selection run when the forms become disabled', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const forms = {
      country: {
        name: 'country',
        displayName: 'Country',
        type: 'Select',
        hidden: false,
        defaultValue: 'kr',
        options: [
          { value: 'kr', displayName: 'Korea' },
          { value: 'us', displayName: 'United States' }
        ]
      }
    };
    const { rerender } = render(
      <ParagraphDynamicForms
        disabled={false}
        forms={forms}
        params={{ country: 'kr' }}
        runOnSelectionChange
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: '1' } });
    rerender(
      <ParagraphDynamicForms
        disabled
        forms={forms}
        params={{ country: 'us' }}
        runOnSelectionChange
        onChange={onChange}
      />
    );
    vi.advanceTimersByTime(800);

    expect(onChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
