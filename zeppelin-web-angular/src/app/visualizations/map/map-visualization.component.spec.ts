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

import { ChangeDetectorRef, ElementRef } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphConfig } from '@zeppelin/sdk';
import type { TableData, Visualization } from '@zeppelin/visualization';

import { MapVisualizationComponent, pngDataUrl } from './map-visualization.component';

// jsdom has SVG elements but omits the capability probe Leaflet uses. Keep
// Leaflet itself real, including its rendering, popup and layer lifecycle.
vi.hoisted(() => {
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', {
    configurable: true,
    value: () => ({})
  });
});

// Direct construction does not use the visualization portal; isolate its token
// to avoid loading unrelated chart libraries and their jsdom canvas probes.
vi.mock('@zeppelin/visualization', () => ({
  VISUALIZATION: Symbol('visualization'),
  Visualization: class {}
}));

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

describe('MapVisualizationComponent', () => {
  const components: MapVisualizationComponent[] = [];
  const containers: HTMLDivElement[] = [];
  const disconnect = vi.fn();

  beforeEach(() => {
    disconnect.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
  });

  afterEach(() => {
    components.forEach(component => component.ngOnDestroy());
    containers.forEach(container => container.remove());
    components.length = 0;
    containers.length = 0;
    vi.unstubAllGlobals();
  });

  const mount = (rows: unknown[], graph = new GraphConfig()) => {
    const configChange$ = new Subject<GraphConfig>();
    const emitted: GraphConfig[] = [];
    configChange$.subscribe(config => emitted.push(config));
    const data: Pick<TableData, 'rows' | 'columns'> = { columns: ['geometry', 'label', 'image'], rows };
    const visualization = { transformed: data, getConfig: () => graph, configChange$ };
    const component = new MapVisualizationComponent(
      visualization as Visualization,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef
    );
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      clientHeight: { value: 400 }
    });
    document.body.append(container);
    component.mapContainer = new ElementRef(container);
    components.push(component);
    containers.push(container);
    component.ngAfterViewInit();
    return { component, container, graph, emitted, data };
  };

  it('renders valid geometries and separately reports invalid and empty rows', () => {
    const { component, container } = mount([
      { geometry: 'POINT (0 0)' },
      { geometry: 'LINESTRING (0 0, 10 20)' },
      { geometry: 'POLYGON ((0 0, 10 0, 10 10, 0 0))' },
      { geometry: 'POINT (999 0)' },
      { geometry: null }
    ]);
    expect(component.featureCount).toBe(3);
    expect(component.invalidRows).toBe(1);
    expect(component.emptyRows).toBe(1);
    expect(component.message).toBe('');
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(3);
  });

  it('places HTML-looking popup values in text nodes', () => {
    const graph = new GraphConfig();
    graph.setting.map = { geometryColumn: 'geometry', infoColumn: 'label' };
    const input = '<img src=x onerror=alert(1)>';
    const { container } = mount([{ geometry: 'POINT (0 0)', label: input }], graph);
    const marker = container.querySelector('.leaflet-overlay-pane path');
    expect(marker).not.toBeNull();
    marker!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const popup = container.querySelector('.leaflet-popup-content');
    expect(popup?.textContent).toBe(input);
    expect(popup?.querySelector('img')).toBeNull();
  });

  it('creates no external background by default and adds/removes it through saved config', () => {
    const { component, container, graph } = mount([{ geometry: 'POINT (0 0)' }]);
    expect(component.showBackground).toBe(false);
    expect(container.querySelector('.leaflet-tile-pane')?.childElementCount).toBe(0);
    graph.setting.map = { geometryColumn: 'geometry', showBackground: true };
    component.render();
    expect(component.showBackground).toBe(true);
    expect(container.querySelector('.leaflet-tile-pane')?.childElementCount).toBe(1);
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain('OpenStreetMap');
    graph.setting.map.showBackground = false;
    component.render();
    expect(container.querySelector('.leaflet-tile-pane')?.childElementCount).toBe(0);
  });

  it('renders legacy settings without mutation and converts only an explicit settings change', () => {
    const legacy = { geometry: { name: 'geometry', index: 0 }, info: { name: 'label', index: 1 } };
    const graph = Object.assign(new GraphConfig(), { mode: 'apache-sedona', setting: { 'apache-sedona': legacy } });
    const before = JSON.stringify(graph);
    const { component, emitted } = mount([{ geometry: 'POINT (0 0)', label: 'origin' }], graph);
    expect(component.featureCount).toBe(1);
    expect(emitted).toEqual([]);
    expect(JSON.stringify(graph)).toBe(before);
    component.changeSettings({ showBackground: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].mode).toBe('map');
    expect(emitted[0].setting.map).toMatchObject({
      geometryColumn: 'geometry',
      infoColumn: 'label',
      showBackground: true
    });
    expect(emitted[0].setting['apache-sedona']).toEqual(legacy);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('replaces the previous data layers on rerender', () => {
    const { component, container, data } = mount([{ geometry: 'POINT (0 0)' }]);
    data.rows = [{ geometry: 'POINT (1 1)' }, { geometry: 'POINT (2 2)' }];
    component.render();
    expect(component.featureCount).toBe(2);
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(2);
  });

  it('shows the missing selected column instead of plotting a replacement', () => {
    const graph = new GraphConfig();
    graph.setting.map = { geometryColumn: 'old geometry' };
    const { component, container } = mount([{ geometry: 'POINT (0 0)' }], graph);
    expect(component.featureCount).toBe(0);
    expect(component.message).toContain('Geometry column "old geometry" is unavailable');
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(0);
  });

  it('renders local PNG images over non-degenerate geometry bounds and counts invalid images', () => {
    const graph = new GraphConfig();
    graph.setting.map = { geometryColumn: 'geometry', imageColumn: 'image' };
    const polygon = 'POLYGON ((0 0, 10 0, 10 10, 0 0))';
    const { component, container } = mount(
      [
        { geometry: polygon, image: PNG },
        { geometry: polygon, image: 'https://example.com/image.png' },
        { geometry: 'POINT (0 0)', image: PNG }
      ],
      graph
    );
    expect(component.featureCount).toBe(3);
    expect(component.invalidImages).toBe(2);
    expect(container.querySelectorAll('img.leaflet-image-layer')).toHaveLength(1);
    expect(container.querySelector('img.leaflet-image-layer')?.getAttribute('src')).toBe(
      `data:image/png;base64,${PNG}`
    );
  });

  it('disconnects observation and removes the real Leaflet map on destruction', () => {
    const { component, container } = mount([{ geometry: 'POINT (0 0)' }]);
    expect(container.classList.contains('leaflet-container')).toBe(true);
    component.ngOnDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(container.querySelector('.leaflet-map-pane')).toBeNull();
  });
});

describe('pngDataUrl', () => {
  it('normalizes raw PNG base64 and PNG data URLs', () => {
    expect(pngDataUrl(PNG)).toBe(`data:image/png;base64,${PNG}`);
    expect(pngDataUrl(`data:image/png;base64,${PNG}`)).toBe(`data:image/png;base64,${PNG}`);
    expect(pngDataUrl(` \n${PNG}\n`)).toBe(`data:image/png;base64,${PNG}`);
  });

  it.each([
    null,
    42,
    '',
    'https://example.com/image.png',
    'javascript:alert(1)',
    '<img src=x>',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/jpeg;base64,/9j/',
    'iVBORw0KGgo'
  ])('rejects invalid PNG input %s', input => {
    expect(pngDataUrl(input)).toBeNull();
  });
});
