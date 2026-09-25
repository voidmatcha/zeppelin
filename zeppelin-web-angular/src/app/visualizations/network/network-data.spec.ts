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

import { describe, expect, it } from 'vitest';

import { entityDetails, layoutNetworkGraph, parseNetworkGraph } from './network-data';

describe('native network result model', () => {
  it('parses the interpreter graph contract and applies label colors', () => {
    const graph = parseNetworkGraph(
      JSON.stringify({
        nodes: [
          { id: 1, label: 'Person', data: { name: 'Alice' } },
          { id: 2, label: 'Person' }
        ],
        edges: [{ id: 3, source: 1, target: 2, label: 'KNOWS' }],
        labels: { Person: '#ff0000' },
        types: ['KNOWS'],
        directed: true
      })
    );

    const positioned = layoutNetworkGraph(graph);

    expect(positioned.nodes).toHaveLength(2);
    expect(positioned.nodes[0].color).toBe('#ff0000');
    expect(positioned.edges[0].sourceNode.id).toBe(1);
    expect(positioned.edges[0].targetNode.id).toBe(2);
    expect(positioned.directed).toBe(true);
  });

  it('supports object endpoints without mutating the source graph', () => {
    const graph = parseNetworkGraph(
      JSON.stringify({
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ id: 'edge', source: { id: 'a' }, target: { id: 'b' } }]
      })
    );

    layoutNetworkGraph(graph);

    expect(graph.edges[0].source).toEqual({ id: 'a' });
    expect(graph.edges[0].target).toEqual({ id: 'b' });
  });

  it('drops an edge whose endpoint is absent while preserving valid entities', () => {
    const graph = parseNetworkGraph(
      JSON.stringify({
        nodes: [{ id: 1 }, { id: 2 }],
        edges: [
          { id: 'valid', source: 1, target: 2 },
          { id: 'orphan', source: 1, target: 99 }
        ]
      })
    );

    expect(layoutNetworkGraph(graph).edges.map(edge => edge.id)).toEqual(['valid']);
  });

  it('renders parallel edges with distinct paths and handles self-loops', () => {
    const graph = parseNetworkGraph(
      JSON.stringify({
        nodes: [{ id: 1 }, { id: 2 }],
        edges: [
          { id: 'first', source: 1, target: 2 },
          { id: 'second', source: 1, target: 2 },
          { id: 'loop', source: 1, target: 1 }
        ]
      })
    );
    const paths = layoutNetworkGraph(graph).edges.map(edge => edge.path);

    expect(new Set(paths).size).toBe(3);
    expect(paths[2]).toContain(' C ');
  });

  it('rejects malformed JSON and duplicate node ids with a useful error', () => {
    expect(() => parseNetworkGraph('{')).toThrow('not valid JSON');
    expect(() => parseNetworkGraph('{"nodes":[{"id":1},{"id":1}]}')).toThrow('must be unique');
  });

  it('formats selected entity details without exposing object coercion artifacts', () => {
    expect(
      entityDetails({ id: 1, label: 'Person', data: { name: 'Alice', metadata: { active: true } } }, 'node')
    ).toEqual([
      ['node_id', '1'],
      ['node_type', 'Person'],
      ['name', 'Alice'],
      ['metadata', '{"active":true}']
    ]);
  });

  it('falls back to a safe color when a graph label contains a CSS resource', () => {
    const graph = parseNetworkGraph(
      JSON.stringify({ nodes: [{ id: 1, label: 'Person' }], labels: { Person: 'url(https://example.invalid)' } })
    );

    expect(layoutNetworkGraph(graph).nodes[0].color).toBe('#1677ff');
  });
});
