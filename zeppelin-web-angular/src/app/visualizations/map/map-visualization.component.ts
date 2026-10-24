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

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  OnDestroy,
  ViewChild
} from '@angular/core';
import * as L from 'leaflet';

import { GraphConfig, VisualizationMap } from '@zeppelin/sdk';
import { TableData, Visualization, VISUALIZATION } from '@zeppelin/visualization';

import { MapSettings, resolveMapSettings, toMapFeatures } from './geospatial-data';

@Component({
  selector: 'zeppelin-map-visualization',
  templateUrl: './map-visualization.component.html',
  styleUrls: ['./map-visualization.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MapVisualizationComponent implements AfterViewInit, OnDestroy {
  private static nextId = 0;
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLDivElement>;
  readonly controlId = `map-settings-${MapVisualizationComponent.nextId++}`;
  config = new GraphConfig();
  settings: MapSettings = { geometryColumn: '' };
  columns: string[] = [];
  featureCount = 0;
  invalidRows = 0;
  emptyRows = 0;
  invalidImages = 0;
  message = '';
  showBackground = false;
  private map?: L.Map;
  private dataLayer?: L.FeatureGroup;
  private background?: L.TileLayer;
  private resizeObserver?: ResizeObserver;
  private data: TableData | undefined;

  constructor(
    @Inject(VISUALIZATION) public visualization: Visualization,
    private cdr: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainer.nativeElement, { scrollWheelZoom: false }).setView([0, 0], 2);
    this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObserver.observe(this.mapContainer.nativeElement);
    this.render();
  }

  render(): void {
    this.config = this.visualization.getConfig();
    this.data = this.visualization.transformed as TableData | undefined;
    this.columns = this.data?.columns ?? [];
    this.settings = resolveMapSettings(this.config, this.columns);
    this.showBackground = this.config.setting.map?.showBackground ?? false;
    this.featureCount = this.invalidRows = this.emptyRows = this.invalidImages = 0;
    this.message = '';
    if (this.dataLayer) {
      this.dataLayer.remove();
      this.dataLayer = undefined;
    }
    this.updateBackground();
    if (!this.columns.includes(this.settings.geometryColumn)) {
      this.message = this.settings.geometryColumn
        ? `Geometry column "${this.settings.geometryColumn}" is unavailable. Choose a column in Setting.`
        : 'Choose a geometry column in Setting to display WKT or GeoJSON.';
    } else if (this.data) {
      const result = toMapFeatures(this.data, this.settings);
      this.featureCount = result.features.length;
      this.invalidRows = result.invalidRows;
      this.emptyRows = result.emptyRows;
      if (!this.featureCount) {
        this.message = 'No valid geometries to display. Use WGS84 longitude/latitude coordinates.';
      }
      if (this.map) {
        this.dataLayer = L.featureGroup().addTo(this.map);
        for (const feature of result.features) {
          const layer = L.geoJSON(feature, {
            pointToLayer: (_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 6,
                color: '#096dd9',
                fillColor: '#1890ff',
                fillOpacity: 0.65,
                weight: 2
              }),
            style: { color: '#096dd9', weight: 2, fillOpacity: 0.15 }
          }).addTo(this.dataLayer);
          const popup = document.createElement('span');
          popup.textContent = feature.properties.info || `Row ${feature.properties.row + 1}`;
          layer.bindPopup(popup);
          if (this.settings.imageColumn) {
            const image = this.data.rows[feature.properties.row]?.[this.settings.imageColumn];
            if (image !== null && image !== undefined && image !== '') {
              const url = pngDataUrl(image);
              const bounds = layer.getBounds();
              if (
                url &&
                bounds.isValid() &&
                bounds.getNorth() !== bounds.getSouth() &&
                bounds.getEast() !== bounds.getWest()
              ) {
                L.imageOverlay(url, bounds, { interactive: false }).addTo(this.dataLayer);
              } else {
                this.invalidImages++;
              }
            }
          }
        }
        this.map.invalidateSize();
        this.fitData();
      }
    }
    this.cdr.markForCheck();
  }

  changeSettings(update: Partial<VisualizationMap>): void {
    const map: VisualizationMap = { ...this.settings, showBackground: this.showBackground, ...update };
    // Conversion is explicit: merely opening a legacy note does not rewrite its settings.
    this.visualization.configChange$?.next({
      ...this.config,
      mode: 'map',
      setting: { ...this.config.setting, map }
    });
  }

  fitData(): void {
    const bounds = this.dataLayer?.getBounds();
    if (bounds?.isValid()) {
      this.map?.fitBounds(bounds, { padding: [24, 24], maxZoom: 14, animate: false });
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.map?.remove();
    this.map = undefined;
  }

  private updateBackground(): void {
    if (!this.map) return;
    if (this.showBackground && !this.background) {
      this.background = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(this.map);
    } else if (!this.showBackground && this.background) {
      this.background.remove();
      this.background = undefined;
    }
  }
}

// Sedona's raster column contains PNG bytes, never a URL or markup.
export const pngDataUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const base64 = value.replace(/^data:image\/png;base64,/, '').replace(/\s/g, '');
  if (!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  try {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    // Require a complete PNG IHDR, including nonzero image dimensions.
    if (bytes.length < 33 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
    const view = new DataView(bytes.buffer);
    if (view.getUint32(8) !== 13 || !view.getUint32(16) || !view.getUint32(20)) return null;
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
};
