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

import { describe, expect, it } from 'vitest';

import { ReactFeatureService } from './react-feature.service';

const query = (entries: Record<string, string>): { get(name: string): string | null } => ({
  get: name => entries[name] ?? null
});

describe('ReactFeatureService', () => {
  const service = new ReactFeatureService();

  it('keeps the notebook and interpreter Angular surfaces as the default', () => {
    expect(service.isEnabled('notebook', query({}))).toBe(false);
    expect(service.isEnabled('interpreter', query({}))).toBe(false);
  });

  it('enables the notebook and interpreter React surfaces explicitly', () => {
    expect(service.isEnabled('notebook', query({ reactNotebook: 'true' }))).toBe(true);
    expect(service.isEnabled('interpreter', query({ reactInterpreter: 'true' }))).toBe(true);
  });

  it('does not change the defaults of the other React surfaces', () => {
    expect(service.isEnabled('publishedParagraph', query({}))).toBe(false);
    expect(service.isEnabled('paragraphFooter', query({}))).toBe(false);
    expect(service.isEnabled('configurationTable', query({}))).toBe(false);
  });
});
