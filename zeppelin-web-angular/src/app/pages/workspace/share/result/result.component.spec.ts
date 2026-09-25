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

import { ChangeDetectorRef, ElementRef, SimpleChange } from '@angular/core';
import { DatasetType } from '@zeppelin/sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@zeppelin/visualizations', () => ({
  AreaChartVisualization: class {},
  BarChartVisualization: class {},
  LineChartVisualization: class {},
  PieChartVisualization: class {},
  ScatterChartVisualization: class {},
  TableVisualization: class {}
}));

import { NotebookParagraphResultComponent } from './result.component';

const createComponent = (
  executeSpellAsDisplaySystem = vi.fn(),
  runtimeCompilerService: { createAndCompileTemplate: ReturnType<typeof vi.fn> } = {
    createAndCompileTemplate: vi.fn()
  }
) => {
  const cdr = { detectChanges: vi.fn(), markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
  const component = new NotebookParagraphResultComponent(
    {} as never,
    {} as never,
    cdr,
    runtimeCompilerService as never,
    {
      bypassSecurityTrustHtml: vi.fn(value => value),
      bypassSecurityTrustUrl: vi.fn(value => value)
    } as never,
    {} as never,
    { executeSpellAsDisplaySystem } as never,
    { destroyInstancesForParagraph: vi.fn(), destroyInstance: vi.fn() } as never
  );
  component.id = 'paragraph';
  component.spellElementId = 'pparagraph_spell_0_elem';
  return component;
};

describe('NotebookParagraphResultComponent Helium Spell rendering', () => {
  it('leaves NETWORK rendering to the network component without treating it as a custom display', () => {
    const execute = vi.fn();
    const component = createComponent(execute);
    component.result = { type: DatasetType.NETWORK, data: '{}' };

    component.renderDefaultDisplay();

    expect(execute).not.toHaveBeenCalled();
    expect(component.frontEndError).toBe('');
    component.ngOnDestroy();
  });

  it('re-renders once when result and config inputs change after view initialization', () => {
    const component = createComponent();
    component.result = { type: DatasetType.TEXT, data: 'first' };
    component.config = { graph: {} as never };
    const render = vi.spyOn(component, 'renderDefaultDisplay');
    vi.spyOn(component, 'renderGraph').mockImplementation(() => undefined);
    component.ngAfterViewInit();
    render.mockClear();

    const previousResult = component.result;
    const previousConfig = component.config;
    component.result = { type: DatasetType.TABLE, data: 'a\tb' };
    component.config = { graph: {} as never };
    component.ngOnChanges({
      result: new SimpleChange(previousResult, component.result, false),
      config: new SimpleChange(previousConfig, component.config, false)
    });

    expect(render).toHaveBeenCalledOnce();
    component.ngOnDestroy();
  });

  it('does not render input changes before the view is initialized', () => {
    const component = createComponent();
    component.result = { type: DatasetType.TEXT, data: 'first' };
    const render = vi.spyOn(component, 'renderDefaultDisplay');

    component.ngOnChanges({ result: new SimpleChange(undefined, component.result, true) });

    expect(render).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('does not render twice when an imperative update is followed by the same input changes', () => {
    const component = createComponent();
    component.result = { type: DatasetType.NETWORK, data: '{}' };
    component.config = { graph: {} as never };
    const render = vi.spyOn(component, 'renderDefaultDisplay');
    component.ngAfterViewInit();
    render.mockClear();

    const nextResult = { type: DatasetType.NETWORK, data: '{"nodes":[]}' };
    const nextConfig = { graph: {} as never };
    component.updateResult(nextConfig, nextResult);
    component.ngOnChanges({
      result: new SimpleChange(component.result, nextResult, false),
      config: new SimpleChange(component.config, nextConfig, false)
    });

    expect(render).toHaveBeenCalledOnce();
    component.ngOnDestroy();
  });

  it('destroys and hides an existing visualization when a TABLE result changes to TEXT', () => {
    const component = createComponent();
    const destroy = vi.fn();
    const visualization = component.visualizations[0];
    visualization.instance = { destroy } as never;
    component.config = { graph: { mode: visualization.id } as never };
    component.result = { type: DatasetType.TEXT, data: 'plain output' };

    component.renderDefaultDisplay();

    expect(destroy).toHaveBeenCalledOnce();
    expect(visualization.instance).toBeUndefined();
    expect(component.getCurrentVisualization()).toBeNull();
    component.ngOnDestroy();
  });

  it('discards a pending ANGULAR template after a newer result is rendered', async () => {
    let resolveTemplate!: (value: { component: never; moduleFactory: never }) => void;
    const runtimeCompilerService = {
      createAndCompileTemplate: vi.fn().mockReturnValue(new Promise(resolve => (resolveTemplate = resolve)))
    };
    const component = createComponent(vi.fn(), runtimeCompilerService);
    component.result = { type: DatasetType.ANGULAR, data: '<div>old</div>' };
    component.renderDefaultDisplay();
    component.result = { type: DatasetType.TEXT, data: 'new' };
    component.renderDefaultDisplay();

    resolveTemplate({ component: class {} as never, moduleFactory: {} as never });
    await Promise.resolve();

    expect(component.angularComponent).toBeNull();
    component.ngOnDestroy();
  });

  it('runs an ELEMENT callback only after its target DOM exists', async () => {
    const callback = vi.fn((targetId: string) => {
      document.getElementById(targetId)!.textContent = 'rendered';
    });
    const component = createComponent();
    const target = document.createElement('div');
    target.id = component.spellElementId;
    document.body.appendChild(target);
    component.spellElement = new ElementRef(target);
    component.result = { type: 'ELEMENT', data: callback, magic: '%flowchart', text: 'source' };

    component.renderDefaultDisplay();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(component.spellElementId);
    expect(target.textContent).toBe('rendered');
    component.ngOnDestroy();
    target.remove();
  });

  it('discards a stale custom-display response after the result changes', async () => {
    let resolveFirst!: (value: Array<{ type: DatasetType; data: string }>) => void;
    let resolveSecond!: (value: Array<{ type: DatasetType; data: string }>) => void;
    const execute = vi
      .fn()
      .mockReturnValueOnce(new Promise(resolve => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise(resolve => (resolveSecond = resolve)));
    const component = createComponent(execute);

    component.result = { type: '%first', data: 'one' };
    component.renderDefaultDisplay();
    component.result = { type: '%second', data: 'two' };
    component.renderDefaultDisplay();
    resolveFirst([{ type: DatasetType.TEXT, data: 'stale' }]);
    await Promise.resolve();
    expect(component.customDisplayResults).toEqual([]);

    resolveSecond([{ type: DatasetType.TEXT, data: 'current' }]);
    await Promise.resolve();
    expect(component.customDisplayResults).toEqual([{ type: DatasetType.TEXT, data: 'current' }]);
    component.ngOnDestroy();
  });

  it('rejects a recursive custom-display chain before executing the Spell again', () => {
    const execute = vi.fn();
    const component = createComponent(execute);
    component.customDisplayPath = ['%loop'];
    component.result = { type: '%loop', data: 'again' };

    component.renderDefaultDisplay();

    expect(execute).not.toHaveBeenCalled();
    expect(component.frontEndError).toContain('cycle detected');
    component.ngOnDestroy();
  });
});
