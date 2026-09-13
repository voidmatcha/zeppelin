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

import { expect, expectTypeOf, it } from 'vitest';

import { NoteForms } from './message-notebook.interface';
import {
  DynamicFormParams,
  DynamicFormsItem,
  DynamicFormsType,
  ParagraphItem,
  ParagraphRuntimeInfo,
  ParagraphSettings,
  RuntimeInfos,
  RuntimeInfosValuesItem
} from './message-paragraph.interface';

it('models runtime infos as a property-name keyed map', () => {
  const infos: RuntimeInfos = {
    spark: {
      propertyName: 'spark',
      label: 'Spark UI',
      tooltip: 'Open the Spark UI',
      group: 'spark',
      values: [{ jobUrl: 'https://example.test/jobs/1', applicationId: 'app-1' }],
      interpreterSettingId: 'setting-1'
    }
  };

  expectTypeOf<RuntimeInfos[string]>().toEqualTypeOf<ParagraphRuntimeInfo | undefined>();
  expectTypeOf<ParagraphRuntimeInfo['values']>().toEqualTypeOf<RuntimeInfosValuesItem[]>();
  expectTypeOf<RuntimeInfosValuesItem>().toEqualTypeOf<Record<string, string>>();
  expect(infos.spark?.values[0]).toEqual({ jobUrl: 'https://example.test/jobs/1', applicationId: 'app-1' });
});

it('keeps arbitrary scalar and structural dynamic-form parameter values', () => {
  expectTypeOf<DynamicFormsItem['defaultValue']>().toEqualTypeOf<unknown>();
  expectTypeOf<NonNullable<DynamicFormsItem['options']>[number]['value']>().toEqualTypeOf<unknown>();
  expectTypeOf<DynamicFormParams[string]>().toEqualTypeOf<unknown>();
  expectTypeOf<NoteForms[string]>().toEqualTypeOf<DynamicFormsItem>();
  expect(Object.values(DynamicFormsType)).toEqual([
    'TextBox',
    'Password',
    'Select',
    'CheckBox',
    'input',
    'select',
    'checkbox'
  ]);
});

it('models paragraph settings as the GUI payload', () => {
  const settings: ParagraphSettings = { params: { limit: 10 }, forms: {} };

  expectTypeOf<ParagraphItem['settings']>().toEqualTypeOf<ParagraphSettings>();
  expectTypeOf<keyof ParagraphSettings>().toEqualTypeOf<'params' | 'forms'>();
  expect(Object.keys(settings)).toEqual(['params', 'forms']);
});
