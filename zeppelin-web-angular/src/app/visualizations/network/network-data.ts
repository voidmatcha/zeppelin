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

export type NetworkEntityValue = string | number | boolean | null | object;

export interface NetworkNode {
  id: string | number;
  label?: string;
  labels?: string[];
  data?: Record<string, NetworkEntityValue>;
}

export interface NetworkEdge {
  id: string | number;
  source: string | number | { id: string | number };
  target: string | number | { id: string | number };
  label?: string;
  data?: Record<string, NetworkEntityValue>;
}

export interface NetworkGraph {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  labels: Record<string, string>;
  types: string[];
  directed: boolean;
}

export interface PositionedNetworkNode extends NetworkNode {
  x: number;
  y: number;
  color: string;
  displayLabel: string;
}

export interface PositionedNetworkEdge extends NetworkEdge {
  path: string;
  sourceNode: PositionedNetworkNode;
  targetNode: PositionedNetworkNode;
}

export interface PositionedNetworkGraph {
  nodes: PositionedNetworkNode[];
  edges: PositionedNetworkEdge[];
  directed: boolean;
}

const DEFAULT_NODE_COLOR = '#1677ff';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const endpointId = (endpoint: NetworkEdge['source']): string => {
  return String(isRecord(endpoint) && 'id' in endpoint ? endpoint.id : endpoint);
};

const safeColor = (color: string | undefined): string => {
  return color && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i.test(color) ? color : DEFAULT_NODE_COLOR;
};

const nodeLabel = (node: NetworkNode): string => {
  return String(node.label || node.labels?.[0] || node.id);
};

export const parseNetworkGraph = (data: string): NetworkGraph => {
  let value: unknown;
  try {
    value = JSON.parse(data.trim() || '{}');
  } catch {
    throw new Error('The network result is not valid JSON.');
  }

  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    throw new Error('The network result must contain a nodes array.');
  }

  const nodes = value.nodes.filter(isRecord) as unknown as NetworkNode[];
  if (nodes.length !== value.nodes.length || nodes.some(node => node.id === null || node.id === undefined)) {
    throw new Error('Every network node must be an object with an id.');
  }
  const nodeIds = nodes.map(node => String(node.id));
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new Error('Network node ids must be unique.');
  }

  const rawEdges = value.edges === undefined || value.edges === null ? [] : value.edges;
  if (!Array.isArray(rawEdges) || rawEdges.some(edge => !isRecord(edge))) {
    throw new Error('The network edges value must be an array.');
  }
  const edges = rawEdges as unknown as NetworkEdge[];
  if (
    edges.some(
      edge =>
        edge.id === null ||
        edge.id === undefined ||
        edge.source === null ||
        edge.source === undefined ||
        edge.target === null ||
        edge.target === undefined
    )
  ) {
    throw new Error('Every network edge must contain id, source, and target values.');
  }

  const labels = isRecord(value.labels)
    ? Object.entries(value.labels).reduce<Record<string, string>>((colors, [label, color]) => {
        if (typeof color === 'string') {
          colors[label] = color;
        }
        return colors;
      }, {})
    : {};
  const types = Array.isArray(value.types)
    ? value.types.filter((type): type is string => typeof type === 'string')
    : [];

  return { nodes, edges, labels, types, directed: value.directed === true };
};

export const layoutNetworkGraph = (graph: NetworkGraph, width = 900, height = 420): PositionedNetworkGraph => {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(40, Math.min(width, height) / 2 - 55);
  const positionedNodes = graph.nodes.map((node, index) => {
    const angle = graph.nodes.length === 1 ? 0 : (2 * Math.PI * index) / graph.nodes.length - Math.PI / 2;
    const displayLabel = nodeLabel(node);
    return {
      ...node,
      x: graph.nodes.length === 1 ? centerX : centerX + radius * Math.cos(angle),
      y: graph.nodes.length === 1 ? centerY : centerY + radius * Math.sin(angle),
      color: safeColor(graph.labels[node.label || node.labels?.[0] || '']),
      displayLabel
    };
  });
  const nodesById = new Map(positionedNodes.map(node => [String(node.id), node]));
  const parallelCounts = new Map<string, number>();

  const positionedEdges: PositionedNetworkEdge[] = [];
  graph.edges.forEach(edge => {
    const sourceNode = nodesById.get(endpointId(edge.source));
    const targetNode = nodesById.get(endpointId(edge.target));
    if (!sourceNode || !targetNode) {
      return;
    }

    const pair = `${String(sourceNode.id)}\u0000${String(targetNode.id)}`;
    const count = parallelCounts.get(pair) ?? 0;
    parallelCounts.set(pair, count + 1);
    let path: string;
    if (sourceNode === targetNode) {
      path = `M ${sourceNode.x} ${sourceNode.y - 10} C ${sourceNode.x + 45} ${sourceNode.y - 65}, ${sourceNode.x - 45} ${sourceNode.y - 65}, ${sourceNode.x} ${sourceNode.y - 10}`;
    } else if (count === 0) {
      path = `M ${sourceNode.x} ${sourceNode.y} L ${targetNode.x} ${targetNode.y}`;
    } else {
      const midpointX = (sourceNode.x + targetNode.x) / 2;
      const midpointY = (sourceNode.y + targetNode.y) / 2;
      const dx = targetNode.x - sourceNode.x;
      const dy = targetNode.y - sourceNode.y;
      const length = Math.hypot(dx, dy) || 1;
      const offset = 24 * Math.ceil(count / 2) * (count % 2 === 1 ? 1 : -1);
      path = `M ${sourceNode.x} ${sourceNode.y} Q ${midpointX - (dy / length) * offset} ${
        midpointY + (dx / length) * offset
      }, ${targetNode.x} ${targetNode.y}`;
    }
    positionedEdges.push({ ...edge, path, sourceNode, targetNode });
  });

  return { nodes: positionedNodes, edges: positionedEdges, directed: graph.directed };
};

export const entityDetails = (entity: NetworkNode | NetworkEdge, type: 'node' | 'edge'): Array<[string, string]> => {
  const details: Array<[string, string]> = [[`${type}_id`, String(entity.id)]];
  if (entity.label) {
    details.push([`${type}_type`, entity.label]);
  }
  Object.entries(entity.data || {}).forEach(([key, value]) => {
    details.push([key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')]);
  });
  return details;
};
