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

import { DynamicFormsType } from '@zeppelin/sdk';
import { describe, expect, it } from 'vitest';

import { NotebookParagraphDynamicFormsComponent, normalizeDynamicFormsType } from './dynamic-forms.component';

describe('normalizeDynamicFormsType', () => {
  it.each([
    [DynamicFormsType.LegacyTextBox, DynamicFormsType.TextBox],
    [DynamicFormsType.LegacySelect, DynamicFormsType.Select],
    [DynamicFormsType.LegacyCheckBox, DynamicFormsType.CheckBox]
  ])('normalizes legacy %s forms to %s', (legacyType, expectedType) => {
    expect(normalizeDynamicFormsType(legacyType)).toBe(expectedType);
  });

  it('preserves modern form types', () => {
    expect(normalizeDynamicFormsType(DynamicFormsType.Password)).toBe(DynamicFormsType.Password);
  });
});

describe('NotebookParagraphDynamicFormsComponent', () => {
  it('preserves false and zero parameter values when applying form definitions', () => {
    const component = new NotebookParagraphDynamicFormsComponent();
    component.formDefs = {
      enabled: {
        defaultValue: true,
        hidden: false,
        name: 'enabled',
        type: DynamicFormsType.TextBox
      },
      count: {
        defaultValue: 10,
        hidden: false,
        name: 'count',
        type: DynamicFormsType.TextBox
      }
    };
    component.paramDefs = { enabled: false, count: 0 };

    component.setForms();

    expect(component.paramDefs).toEqual({ enabled: false, count: 0 });
  });

  it('round-trips arbitrary checkbox option values through ng-zorro indexes', () => {
    const component = new NotebookParagraphDynamicFormsComponent();
    const objectValue = { id: 'object-choice' };
    component.formDefs = {
      choices: {
        defaultValue: [],
        hidden: false,
        name: 'choices',
        type: DynamicFormsType.CheckBox,
        options: [{ value: false }, { value: 0 }, { value: objectValue }]
      }
    };
    component.paramDefs = { choices: [false, { id: 'object-choice' }] };

    component.setForms();
    expect(component.checkboxValues.choices).toEqual([0, 2]);

    component.checkboxChange([1, 2], 'choices');
    expect(component.paramDefs.choices).toEqual([0, objectValue]);
  });

  it('matches structurally equal select option values', () => {
    const component = new NotebookParagraphDynamicFormsComponent();

    expect(component.compareDynamicFormValues({ id: 'choice' }, { id: 'choice' })).toBe(true);
    expect(component.compareDynamicFormValues({ id: 'choice' }, { id: 'other' })).toBe(false);
  });
});
