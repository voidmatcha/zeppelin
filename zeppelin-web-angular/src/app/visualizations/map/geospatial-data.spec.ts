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

import { GraphConfig } from '@zeppelin/sdk';

import { LEGACY_MAP_MODES, resolveMapSettings, toMapFeatures } from './geospatial-data';

describe('resolveMapSettings', () => {
  it.each(LEGACY_MAP_MODES)('adapts saved %s geometry, info and raster columns without changing the graph', mode => {
    const graph = Object.assign(new GraphConfig(), {
      mode,
      setting: {
        [mode]: {
          geometry: { name: 'shape', index: 0 },
          info: { name: 'label', index: 1 },
          mapimage: { name: 'raster', index: 2 }
        }
      }
    });
    const before = JSON.stringify(graph);
    expect(resolveMapSettings(graph, ['shape', 'label', 'raster'])).toEqual({
      geometryColumn: 'shape',
      infoColumn: 'label',
      imageColumn: 'raster'
    });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('uses saved indexes when names are absent, preserving index zero', () => {
    const graph = Object.assign(new GraphConfig(), {
      mode: 'apache-sedona',
      setting: { 'apache-sedona': { geometry: { index: 0 }, info: { index: 1 } } }
    });
    expect(resolveMapSettings(graph, ['shape', 'label'])).toMatchObject({
      geometryColumn: 'shape',
      infoColumn: 'label'
    });
  });

  it('keeps stale names instead of substituting the column at their old index', () => {
    const graph = Object.assign(new GraphConfig(), {
      mode: 'apache-sedona',
      setting: { 'apache-sedona': { geometry: { name: 'removed', index: 0 } } }
    });
    expect(resolveMapSettings(graph, ['geometry']).geometryColumn).toBe('removed');
    graph.setting = { map: { geometryColumn: 'also removed', infoColumn: 'label', imageColumn: 'raster' } };
    expect(resolveMapSettings(graph, ['geometry'])).toEqual({
      geometryColumn: 'also removed',
      infoColumn: 'label',
      imageColumn: 'raster'
    });
  });

  it('gives native settings precedence over legacy settings', () => {
    const graph = Object.assign(new GraphConfig(), {
      mode: 'apache-sedona',
      setting: { map: { geometryColumn: 'native' }, 'apache-sedona': { geometry: { name: 'legacy', index: 0 } } }
    });
    expect(resolveMapSettings(graph, ['legacy', 'native']).geometryColumn).toBe('native');
  });

  it('does not auto-select geometry when an explicit legacy selection is missing', () => {
    const graph = Object.assign(new GraphConfig(), {
      mode: 'apache-sedona',
      setting: { 'apache-sedona': { geometry: { index: 9 } } }
    });
    expect(resolveMapSettings(graph, ['geometry']).geometryColumn).toBe('');
  });

  it('auto-selects a geometry column or the first column only without saved settings', () => {
    const graph = new GraphConfig();
    expect(resolveMapSettings(graph, ['label', 'WKT']).geometryColumn).toBe('WKT');
    expect(resolveMapSettings(graph, ['shape', 'label']).geometryColumn).toBe('shape');
    expect(resolveMapSettings(graph, []).geometryColumn).toBe('');
  });
});

describe('toMapFeatures', () => {
  const convert = (values: unknown[]) => {
    return toMapFeatures(
      { columns: ['shape', 'label'], rows: values.map((shape, row) => ({ shape, label: row })) },
      { geometryColumn: 'shape', infoColumn: 'label' }
    );
  };

  it('parses WKT points, lines, multi-geometries and collections, including zero coordinates', () => {
    const result = convert([
      'POINT (0 0)',
      'LINESTRING (0 0, 10 20)',
      'MULTIPOINT ((0 0), (10 20))',
      'MULTILINESTRING ((0 0, 10 20))',
      'MULTIPOLYGON (((0 0, 10 0, 10 10, 0 0)))',
      'GEOMETRYCOLLECTION (POINT (0 0), LINESTRING (0 0, 10 20))'
    ]);
    expect(result.features.map(feature => feature.geometry.type)).toEqual([
      'Point',
      'LineString',
      'MultiPoint',
      'MultiLineString',
      'MultiPolygon',
      'GeometryCollection'
    ]);
    expect(result.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { info: '0', row: 0 }
    });
    expect(result.invalidRows).toBe(0);
    expect(result.emptyRows).toBe(0);
  });

  it('preserves polygon holes', () => {
    const result = convert(['POLYGON ((0 0, 10 0, 10 10, 0 0), (1 1, 2 1, 2 2, 1 1))']);
    expect(result.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0]
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 1]
        ]
      ]
    });
  });

  it('accepts GeoJSON geometry objects, geometry JSON and Feature JSON without copying their properties', () => {
    const geometry = { type: 'Point', coordinates: [127, 37] };
    const result = convert([
      geometry,
      JSON.stringify(geometry),
      JSON.stringify({
        type: 'Feature',
        geometry,
        properties: { info: 'untrusted replacement' }
      })
    ]);
    expect(result.features.map(feature => feature.geometry)).toEqual([geometry, geometry, geometry]);
    expect(result.features.map(feature => feature.properties.info)).toEqual(['0', '1', '2']);
  });

  it('accepts SRID 4326 and rejects projected coordinates, non-finite values and malformed rows', () => {
    const result = convert([
      'SRID=4326;POINT (180 -90)',
      'SRID=3857;POINT (0 0)',
      'POINT (181 0)',
      'POINT (0 -91)',
      'POINT (NaN 1)',
      'not WKT',
      '{broken json',
      { type: 'Point', coordinates: [Infinity, 0] },
      { type: 'Point', coordinates: ['1', 0] },
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [9, 9]
          ]
        ]
      },
      { type: 'FeatureCollection', features: [] }
    ]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [180, -90] });
    expect(result.invalidRows).toBe(10);
    expect(result.emptyRows).toBe(0);
  });

  it('counts null, blank and empty geometries separately from malformed rows', () => {
    const result = convert([
      null,
      undefined,
      '',
      '  ',
      'POINT EMPTY',
      'POLYGON EMPTY',
      'GEOMETRYCOLLECTION EMPTY',
      { type: 'Point', coordinates: [] },
      { type: 'GeometryCollection', geometries: [] },
      { type: 'Feature', geometry: null, properties: {} },
      'POINT nope'
    ]);
    expect(result.features).toEqual([]);
    expect(result.emptyRows).toBe(10);
    expect(result.invalidRows).toBe(1);
  });

  it('removes empty collection children and rejects malformed collection children', () => {
    const result = convert([
      {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [] },
          { type: 'Point', coordinates: [0, 0] }
        ]
      },
      { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [999, 0] }] }
    ]);
    expect(result.features[0].geometry).toEqual({
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [0, 0] }]
    });
    expect(result.invalidRows).toBe(1);
  });

  it('keeps plain popup text and source row numbers without changing the table', () => {
    const table = {
      columns: ['shape', 'label'],
      rows: [
        { shape: 'bad', label: 'ignored' },
        { shape: 'POINT (0 0)', label: '<img src=x onerror=alert(1)>' },
        { shape: 'POINT (1 1)', label: null }
      ]
    };
    const before = JSON.stringify(table);
    const result = toMapFeatures(table, { geometryColumn: 'shape', infoColumn: 'label' });
    expect(result.features.map(feature => feature.properties)).toEqual([
      { info: '<img src=x onerror=alert(1)>', row: 1 },
      { info: '', row: 2 }
    ]);
    expect(JSON.stringify(table)).toBe(before);
  });

  it('marks unavailable geometry columns invalid rather than treating rows as empty', () => {
    const result = toMapFeatures({ columns: ['label'], rows: [{ label: 'one' }] }, { geometryColumn: 'removed' });
    expect(result).toEqual({ features: [], invalidRows: 1, emptyRows: 0 });
  });
});
