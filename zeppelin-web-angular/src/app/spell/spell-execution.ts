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

import { DatasetType, ParagraphIResultsMsgItem } from '@zeppelin/sdk';

import {
  HeliumSpellConfigResponse,
  HeliumSpellDataWithType,
  HeliumSpellElementCallback,
  HeliumSpellResultItem
} from '../interfaces/helium';

const supportedDisplayTypes = new Set<string>([
  DatasetType.TABLE,
  DatasetType.HTML,
  DatasetType.ANGULAR,
  DatasetType.TEXT,
  DatasetType.IMG,
  DatasetType.NETWORK
]);

const parseConfigValue = (type: unknown, value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    if (type === 'number') {
      const parsed = Number.parseFloat(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    if (type === 'json') {
      return JSON.parse(value);
    }
  } catch {
    return value;
  }
  return value;
};

export const createSpellConfig = (response: HeliumSpellConfigResponse): Record<string, unknown> => {
  const persisted = response.confPersisted || {};
  return Object.entries(response.confSpec || {}).reduce<Record<string, unknown>>((config, [name, field]) => {
    const persistedValue = Object.prototype.hasOwnProperty.call(persisted, name) ? persisted[name] : field.defaultValue;
    config[name] = parseConfigValue(field.type, persistedValue);
    return config;
  }, {});
};

const serializeSpellData = (data: unknown): string => {
  if (typeof data === 'string') {
    return data;
  }
  if (data === undefined || data === null) {
    return '';
  }
  return typeof data === 'object' ? JSON.stringify(data) : String(data);
};

export const normalizeSpellResults = (results: HeliumSpellDataWithType[]): HeliumSpellResultItem[] =>
  results.map(result => {
    if (result.type === 'ELEMENT') {
      if (typeof result.data !== 'function') {
        throw new Error('Helium Spell ELEMENT results must provide a DOM callback.');
      }
      return {
        type: result.type,
        data: result.data as HeliumSpellElementCallback,
        magic: result.magic,
        text: result.text
      };
    }
    return {
      type: supportedDisplayTypes.has(result.type) ? (result.type as DatasetType) : result.type,
      data: serializeSpellData(result.data),
      magic: result.magic,
      text: result.text
    };
  });

export const createPropagableSpellResults = (results: HeliumSpellResultItem[]): ParagraphIResultsMsgItem[] =>
  results.map(result => {
    if (typeof result.data !== 'function') {
      return { type: result.type as DatasetType, data: result.data };
    }
    if (!result.magic) {
      throw new Error('Helium Spell ELEMENT result is missing its source magic.');
    }
    return {
      type: result.magic as DatasetType,
      data: result.text || ''
    };
  });
