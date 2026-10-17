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

import { interpreterLogoUrl } from './interpreter-logo';

const url = (key: string) => `assets/images/interpreters/${key}.svg`;

describe('interpreterLogoUrl', () => {
  it('picks the logo by the name of the setting', () => {
    expect(interpreterLogoUrl('spark')).toBe(url('spark'));
    expect(interpreterLogoUrl('python')).toBe(url('python'));
    expect(interpreterLogoUrl('md')).toBe(url('md'));
    expect(interpreterLogoUrl('sh')).toBe(url('sh'));
    expect(interpreterLogoUrl('jdbc')).toBe(url('jdbc'));
    expect(interpreterLogoUrl('flink')).toBe(url('flink'));
  });

  it('knows the common aliases and versioned names', () => {
    expect(interpreterLogoUrl('shell')).toBe(url('sh'));
    expect(interpreterLogoUrl('markdown')).toBe(url('md'));
    expect(interpreterLogoUrl('sql')).toBe(url('jdbc'));
    expect(interpreterLogoUrl('spark3')).toBe(url('spark'));
  });

  it('falls back to the %name of the paragraph for a setting it does not know', () => {
    expect(interpreterLogoUrl('my_cluster', 'spark.pyspark')).toBe(url('spark'));
  });

  it('shows a neutral glyph when nothing matches', () => {
    expect(interpreterLogoUrl('custom')).toBe(url('generic'));
    expect(interpreterLogoUrl(undefined, undefined)).toBe(url('generic'));
  });
});
