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

import { NO_ERRORS_SCHEMA, provideZoneChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { describe, expect, it } from 'vitest';

import type { Interpreter } from '@zeppelin/interfaces';
import { InterpreterService, SecurityService, TicketService } from '@zeppelin/services';

import { InterpreterComponent } from '../interpreter.component';
import { InterpreterItemComponent } from './item.component';
import template from './item.component.html?raw';

type PropertyValue = Interpreter['properties'][string]['value'];
type PropertyType = Interpreter['properties'][string]['type'];

const renderViewModeValueCell = async (value: PropertyValue, type: PropertyType = 'checkbox') => {
  await TestBed.configureTestingModule({
    declarations: [InterpreterItemComponent],
    // NO_ERRORS_SCHEMA cannot stand in for the checkbox value accessors or the nzDropdownMenu export.
    imports: [ReactiveFormsModule, NzCheckboxModule, NzDropDownModule],
    providers: [
      provideZoneChangeDetection(),
      { provide: InterpreterComponent, useValue: {} },
      {
        provide: TicketService,
        useValue: { originTicket: { principal: 'anonymous' }, ticket: { principal: 'anonymous' } }
      },
      { provide: SecurityService, useValue: {} },
      { provide: InterpreterService, useValue: {} }
    ],
    schemas: [NO_ERRORS_SCHEMA]
  })
    .overrideComponent(InterpreterItemComponent, {
      set: { template, templateUrl: undefined, styles: [], styleUrls: [] }
    })
    .compileComponents();

  const fixture = TestBed.createComponent(InterpreterItemComponent);
  const interpreter: Interpreter = {
    id: 'spark',
    name: 'spark',
    group: 'spark',
    status: 'READY',
    interpreterGroup: [],
    dependencies: [],
    // shared/shared resolves to "Globally" without consulting the ticket.
    option: {
      perNote: 'shared',
      perUser: 'shared'
    } as Interpreter['option'],
    properties: {
      'zeppelin.spark.useHiveContext': { name: 'zeppelin.spark.useHiveContext', value, type }
    }
  };
  fixture.componentInstance.mode = 'view';
  fixture.componentInstance.interpreter = interpreter;
  fixture.detectChanges();
  await fixture.whenStable();

  const row = fixture.nativeElement.querySelector('tbody tr') as HTMLTableRowElement | null;
  expect(row).not.toBeNull();
  const [nameCell, valueCell] = Array.from(row!.cells);
  expect(nameCell.textContent?.trim()).toBe('zeppelin.spark.useHiveContext');
  return valueCell.textContent?.trim();
};

describe('InterpreterItemComponent view-mode property value (TestBed)', () => {
  it.each([
    { value: false, expected: 'false' },
    { value: true, expected: 'true' }
  ])('renders the checkbox value $value as text in the Value cell', async ({ value, expected }) => {
    expect(await renderViewModeValueCell(value)).toBe(expected);
  });

  it.each([
    { value: '0', type: 'number', expected: '0' },
    { value: '', type: 'string', expected: '' }
  ] as const)('renders the $type value "$value" as "$expected"', async ({ value, type, expected }) => {
    expect(await renderViewModeValueCell(value, type)).toBe(expected);
  });

  it.each([null, undefined])('renders an absent value %s as an empty cell', async value => {
    expect(await renderViewModeValueCell(value as unknown as PropertyValue)).toBe('');
  });
});
