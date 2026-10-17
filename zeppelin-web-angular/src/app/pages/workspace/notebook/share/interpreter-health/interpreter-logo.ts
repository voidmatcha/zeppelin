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

const LOGO_KEYS = ['python', 'sh', 'md', 'spark', 'flink', 'java', 'groovy', 'jdbc'] as const;

const ALIASES: Record<string, (typeof LOGO_KEYS)[number]> = {
  shell: 'sh',
  markdown: 'md',
  sql: 'jdbc',
  ipython: 'python',
  pyspark: 'spark',
  ipyspark: 'spark'
};

const keyOf = (name: string | undefined): string | undefined => {
  const head = (name ?? '').toLowerCase().split('.')[0];
  if (head.startsWith('spark')) {
    return 'spark';
  }
  if (head.startsWith('flink')) {
    return 'flink';
  }
  const key = ALIASES[head] ?? head;
  return (LOGO_KEYS as readonly string[]).includes(key) ? key : undefined;
};

/**
 * The logo of the interpreter a paragraph runs on: the name of its setting first, then the `%name` in the
 * paragraph, then a neutral glyph for the settings that have no logo of their own.
 */
export const interpreterLogoUrl = (settingName: string | undefined, replName?: string): string =>
  `assets/images/interpreters/${keyOf(settingName) ?? keyOf(replName) ?? 'generic'}.svg`;
