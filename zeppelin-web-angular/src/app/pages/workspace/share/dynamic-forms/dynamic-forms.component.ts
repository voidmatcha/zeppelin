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
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { isEqual } from 'lodash';

import { NzCheckboxOption } from 'ng-zorro-antd/checkbox';

import { DynamicForms, DynamicFormsItem, DynamicFormsType, DynamicFormParams } from '@zeppelin/sdk';

export const normalizeDynamicFormsType = (type: DynamicFormsType): DynamicFormsType => {
  switch (type) {
    case DynamicFormsType.LegacyTextBox:
      return DynamicFormsType.TextBox;
    case DynamicFormsType.LegacySelect:
      return DynamicFormsType.Select;
    case DynamicFormsType.LegacyCheckBox:
      return DynamicFormsType.CheckBox;
    default:
      return type;
  }
};

export const getDynamicFormsOptionLabel = (option: NonNullable<DynamicFormsItem['options']>[number]): string =>
  option.displayName ?? String(option.value);

@Component({
  selector: 'zeppelin-notebook-paragraph-dynamic-forms',
  templateUrl: './dynamic-forms.component.html',
  styleUrls: ['./dynamic-forms.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NotebookParagraphDynamicFormsComponent implements OnInit, OnChanges, OnDestroy {
  private destroy$ = new Subject<void>();

  @Input() formDefs!: DynamicForms;
  @Input() paramDefs!: DynamicFormParams;
  @Input() runOnChange?: boolean = false;
  @Input() disable = false;
  @Input() removable = false;
  @Output() readonly formChange = new EventEmitter<void>();
  @Output() readonly formRemove = new EventEmitter<DynamicFormsItem>();

  formChange$ = new Subject<void>();
  forms: DynamicFormsItem[] = [];
  formType = DynamicFormsType;
  getDynamicFormsOptionLabel = getDynamicFormsOptionLabel;
  compareDynamicFormValues = isEqual;
  checkboxGroups: {
    [key: string]: NzCheckboxOption[];
  } = {};
  checkboxValues: {
    [key: string]: Array<string | number>;
  } = {};
  private checkboxOptionValues: {
    [key: string]: unknown[];
  } = {};

  @HostListener('keydown.enter')
  onEnter() {
    if (!this.runOnChange) {
      this.formChange.emit();
    }
  }

  trackByNameFn(_index: number, form: DynamicFormsItem) {
    return form.name;
  }

  setForms() {
    this.forms = Object.values(this.formDefs).map(form => ({
      ...form,
      type: normalizeDynamicFormsType(form.type)
    }));
    this.checkboxGroups = {};
    this.checkboxOptionValues = {};
    this.forms.forEach(e => {
      if (!Object.prototype.hasOwnProperty.call(this.paramDefs, e.name)) {
        this.paramDefs[e.name] = e.defaultValue;
      }
      if (e.type === DynamicFormsType.CheckBox) {
        // CheckBox type should have defined 'options'.
        // ng-zorro v19 split nz-checkbox-group into `nzOptions` (the {label, value}
        // choices) and an ngModel that holds the selected values directly, instead
        // of a single array of {label, value, checked} objects.
        const options = e.options ?? [];
        this.checkboxOptionValues[e.name] = options.map(option => option.value);
        this.checkboxGroups[e.name] = options.map((option, index) => ({
          label: getDynamicFormsOptionLabel(option),
          value: index
        }));
        const param = this.paramDefs[e.name];
        const selectedValues = Array.isArray(param) ? param : [];
        this.checkboxValues[e.name] = options.reduce<Array<string | number>>((selectedIndexes, option, index) => {
          if (selectedValues.some(selectedValue => isEqual(selectedValue, option.value))) {
            selectedIndexes.push(index);
          }
          return selectedIndexes;
        }, []);
      }
    });
  }

  checkboxChange(value: Array<string | number>, name: string) {
    const optionValues = this.checkboxOptionValues[name] ?? [];
    this.paramDefs[name] = value.reduce<unknown[]>((selectedValues, optionIndex) => {
      const index = Number(optionIndex);
      if (Number.isInteger(index) && index >= 0 && index < optionValues.length) {
        selectedValues.push(optionValues[index]);
      }
      return selectedValues;
    }, []);
    this.onFormChange();
  }

  onFormChange() {
    if (this.runOnChange) {
      this.formChange$.next();
    }
  }

  remove(item: DynamicFormsItem) {
    this.formRemove.emit(item);
  }

  constructor() {}

  ngOnInit() {
    this.setForms();
    this.formChange$.pipe(debounceTime(800), takeUntil(this.destroy$)).subscribe(() => this.formChange.emit());
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.setForms();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
