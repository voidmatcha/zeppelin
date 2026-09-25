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

import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';

import {
  entityDetails,
  layoutNetworkGraph,
  NetworkEdge,
  NetworkNode,
  parseNetworkGraph,
  PositionedNetworkGraph
} from './network-data';

@Component({
  selector: 'zeppelin-visualization-network',
  templateUrl: './network-visualization.component.html',
  styleUrls: ['./network-visualization.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NetworkVisualizationComponent implements OnChanges {
  private static markerSequence = 0;

  @Input() data = '';

  readonly markerId = `zeppelin-network-arrow-${NetworkVisualizationComponent.markerSequence++}`;
  graph?: PositionedNetworkGraph;
  error = '';
  selectedDetails: Array<[string, string]> = [];

  ngOnChanges(): void {
    try {
      this.graph = layoutNetworkGraph(parseNetworkGraph(this.data));
      this.error = '';
      this.selectedDetails = [];
    } catch (error) {
      this.graph = undefined;
      this.error = error instanceof Error ? error.message : 'The network result could not be rendered.';
    }
  }

  selectNode(node: NetworkNode): void {
    this.selectedDetails = entityDetails(node, 'node');
  }

  selectEdge(edge: NetworkEdge): void {
    this.selectedDetails = entityDetails(edge, 'edge');
  }
}
