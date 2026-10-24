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

import { wktToGeoJSON } from '@terraformer/wkt';
import type { Feature, Geometry, Position } from 'geojson';

import type { GraphConfig } from '@zeppelin/sdk';
import type { TableData } from '@zeppelin/visualization';

export const LEGACY_MAP_MODES = ['apache-sedona', 'sedona-zeppelin', 'geospark-zeppelin'] as const;

export const isMapVisualizationMode = (mode: string): boolean =>
  mode === 'map' || LEGACY_MAP_MODES.some(legacy => legacy === mode);

export interface MapSettings {
  geometryColumn: string;
  infoColumn?: string;
  imageColumn?: string;
}

type MapFeature = Feature<Geometry, { info: string; row: number }>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const legacyColumn = (value: unknown, columns: string[]): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  // A saved name is authoritative even after the query's columns change.
  if (typeof value.name === 'string') {
    return value.name;
  }
  return typeof value.index === 'number' && Number.isInteger(value.index) ? columns[value.index] : undefined;
};

export const resolveMapSettings = (graph: GraphConfig, columns: string[]): MapSettings => {
  const settings = graph.setting as Record<string, unknown>;
  if (isRecord(settings.map)) {
    return {
      geometryColumn: typeof settings.map.geometryColumn === 'string' ? settings.map.geometryColumn : '',
      infoColumn: typeof settings.map.infoColumn === 'string' ? settings.map.infoColumn : undefined,
      imageColumn: typeof settings.map.imageColumn === 'string' ? settings.map.imageColumn : undefined
    };
  }
  if (LEGACY_MAP_MODES.some(mode => mode === graph.mode) && isRecord(settings[graph.mode])) {
    const legacy = settings[graph.mode] as Record<string, unknown>;
    return {
      geometryColumn: legacyColumn(legacy.geometry, columns) ?? '',
      infoColumn: legacyColumn(legacy.info, columns),
      imageColumn: legacyColumn(legacy.mapimage, columns)
    };
  }
  return {
    geometryColumn: columns.find(column => /^(geometry|geom|wkt)$/i.test(column)) ?? columns[0] ?? ''
  };
};

const validPosition = (value: unknown): value is Position => {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(ordinate => typeof ordinate === 'number' && Number.isFinite(ordinate)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
};

const validLine = (value: unknown): value is Position[] => {
  return Array.isArray(value) && value.length >= 2 && value.every(validPosition);
};

const validRing = (value: unknown): value is Position[] => {
  if (!Array.isArray(value) || value.length < 4 || !value.every(validPosition)) {
    return false;
  }
  const first = value[0];
  const last = value[value.length - 1];
  return first.length === last.length && first.every((ordinate, index) => ordinate === last[index]);
};

const validPolygon = (value: unknown): boolean => {
  return Array.isArray(value) && value.length > 0 && value.every(validRing);
};

// undefined means malformed; null means a valid empty geometry. Collections
// discard empty children so Leaflet never receives an empty Point coordinate.
const validatedGeometry = (value: unknown, depth = 0): Geometry | null | undefined => {
  if (!isRecord(value) || depth > 32) {
    return undefined;
  }
  if (value.type === 'GeometryCollection') {
    if (!Array.isArray(value.geometries)) {
      return undefined;
    }
    const geometries: Geometry[] = [];
    for (const child of value.geometries) {
      const geometry = validatedGeometry(child, depth + 1);
      if (geometry === undefined) {
        return undefined;
      }
      if (geometry !== null) {
        geometries.push(geometry);
      }
    }
    return geometries.length ? { type: 'GeometryCollection', geometries } : null;
  }
  const coordinates = value.coordinates;
  const knownType = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(
    String(value.type)
  );
  if (!knownType || !Array.isArray(coordinates)) {
    return undefined;
  }
  if (coordinates.length === 0) {
    return null;
  }
  let valid = false;
  switch (value.type) {
    case 'Point':
      valid = validPosition(coordinates);
      break;
    case 'MultiPoint':
      valid = coordinates.every(validPosition);
      break;
    case 'LineString':
      valid = validLine(coordinates);
      break;
    case 'MultiLineString':
      valid = coordinates.every(validLine);
      break;
    case 'Polygon':
      valid = validPolygon(coordinates);
      break;
    case 'MultiPolygon':
      valid = coordinates.every(validPolygon);
      break;
  }
  return valid ? ({ type: value.type, coordinates } as Geometry) : undefined;
};

const parseGeometry = (value: unknown): Geometry | null | undefined => {
  if (value === null || value === undefined) {
    return null;
  }
  let parsed: unknown = value;
  if (typeof value === 'string') {
    let text = value.trim();
    if (!text) {
      return null;
    }
    const srid = /^SRID\s*=\s*(\d+)\s*;/i.exec(text);
    if (srid) {
      if (Number(srid[1]) !== 4326) {
        return undefined;
      }
      text = text.slice(srid[0].length).trim();
    }
    if (
      /^(POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON|GEOMETRYCOLLECTION)\s+(?:ZM?\s+|M\s+)?EMPTY$/i.test(
        text
      )
    ) {
      return null;
    }
    parsed = text.startsWith('{') ? JSON.parse(text) : wktToGeoJSON(text);
  }
  if (isRecord(parsed) && parsed.type === 'Feature') {
    parsed = parsed.geometry;
    if (parsed === null) {
      return null;
    }
  }
  return validatedGeometry(parsed);
};

export const toMapFeatures = (
  tableData: Pick<TableData, 'columns' | 'rows'>,
  settings: MapSettings
): { features: MapFeature[]; invalidRows: number; emptyRows: number } => {
  const features: MapFeature[] = [];
  let invalidRows = 0;
  let emptyRows = 0;
  const hasGeometryColumn = tableData.columns.includes(settings.geometryColumn);
  tableData.rows.forEach((row: unknown, index: number) => {
    try {
      if (!hasGeometryColumn || !isRecord(row)) {
        invalidRows++;
        return;
      }
      const geometry = parseGeometry(row[settings.geometryColumn]);
      if (geometry === undefined) {
        invalidRows++;
      } else if (geometry === null) {
        emptyRows++;
      } else {
        const info = settings.infoColumn ? row[settings.infoColumn] : undefined;
        features.push({
          type: 'Feature',
          geometry,
          properties: { info: info === null || info === undefined ? '' : String(info), row: index }
        });
      }
    } catch {
      invalidRows++;
    }
  });
  return { features, invalidRows, emptyRows };
};
