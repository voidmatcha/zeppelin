/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DatasetType } from '@zeppelin/sdk';
import { describe, expect, it } from 'vitest';

import { createPropagableSpellResults, createSpellConfig, normalizeSpellResults } from './spell-execution';

describe('Helium Spell execution helpers', () => {
  it('merges persisted configuration while preserving false and zero values', () => {
    expect(
      createSpellConfig({
        confSpec: {
          enabled: { type: 'string', defaultValue: true },
          count: { type: 'number', defaultValue: 10 },
          options: { type: 'json', defaultValue: {} }
        },
        confPersisted: { enabled: false, count: '0', options: '{"color":"blue"}' }
      })
    ).toEqual({ enabled: false, count: 0, options: { color: 'blue' } });
  });

  it('falls back to defaults and leaves malformed typed values unchanged', () => {
    expect(
      createSpellConfig({
        confSpec: {
          count: { type: 'number', defaultValue: 4 },
          options: { type: 'json', defaultValue: { safe: true } }
        },
        confPersisted: { options: '{not-json' }
      })
    ).toEqual({ count: 4, options: '{not-json' });
  });

  it('normalizes all display types supported by the Angular result renderer', () => {
    expect(
      normalizeSpellResults([
        { type: DatasetType.TEXT, data: 42 },
        { type: DatasetType.NETWORK, data: { nodes: [], edges: [] } }
      ])
    ).toEqual([
      { type: DatasetType.TEXT, data: '42' },
      { type: DatasetType.NETWORK, data: '{"nodes":[],"edges":[]}' }
    ]);
  });

  it('preserves DOM callbacks and nested custom display results for local rendering', () => {
    const callback = () => undefined;

    expect(
      normalizeSpellResults([
        { type: 'ELEMENT', data: callback, magic: '%flowchart', text: 'start=>start' },
        { type: '%custom', data: 'value' }
      ])
    ).toEqual([
      { type: 'ELEMENT', data: callback, magic: '%flowchart', text: 'start=>start' },
      { type: '%custom', data: 'value', magic: undefined, text: undefined }
    ]);
  });

  it('converts DOM callbacks back to source text before server propagation', () => {
    expect(
      createPropagableSpellResults([
        { type: 'ELEMENT', data: () => undefined, magic: '%flowchart', text: 'start=>start' },
        { type: DatasetType.TEXT, data: 'done' }
      ])
    ).toEqual([
      { type: '%flowchart', data: 'start=>start' },
      { type: DatasetType.TEXT, data: 'done' }
    ]);
  });

  it('rejects malformed ELEMENT values before rendering or propagation', () => {
    expect(() => normalizeSpellResults([{ type: 'ELEMENT', data: 'not a callback' }])).toThrow('DOM callback');
    expect(() => createPropagableSpellResults([{ type: 'ELEMENT', data: () => undefined }])).toThrow('source magic');
  });
});
