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

import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ElasticInputComponent } from './elastic-input/elastic-input.component';
import { NotebookInterpreterHealthComponent } from './interpreter-health/interpreter-health.component';

@NgModule({
  declarations: [ElasticInputComponent, NotebookInterpreterHealthComponent],
  exports: [ElasticInputComponent, NotebookInterpreterHealthComponent],
  imports: [CommonModule, NzInputModule, FormsModule, NzBadgeModule, NzTooltipModule]
})
export class NotebookShareModule {}
