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

export interface HeliumApplicationPackage {
  type: 'APPLICATION';
  name: string;
  description?: string;
  artifact?: string;
  className?: string;
  resources?: string[][];
  license?: string;
  icon?: string;
  published?: string;
  config?: Record<string, unknown>;
}

export type HeliumApplicationStatus = 'LOADING' | 'LOADED' | 'UNLOADING' | 'UNLOADED' | 'ERROR';

export interface HeliumApplicationState {
  id: string;
  pkg: HeliumApplicationPackage;
  status: HeliumApplicationStatus;
  output: string;
}

export interface HeliumApplicationSuggestions {
  available: Array<{ pkg: HeliumApplicationPackage }>;
}

interface HeliumApplicationEvent {
  noteId: string;
  paragraphId: string;
  appId: string;
}

export interface HeliumApplicationLoad extends HeliumApplicationEvent {
  pkg: HeliumApplicationPackage;
}

export interface HeliumApplicationAppendOutput extends HeliumApplicationEvent {
  index: number;
  data: string;
}

export interface HeliumApplicationUpdateOutput extends HeliumApplicationAppendOutput {
  type: string;
}

export interface HeliumApplicationStatusChange extends HeliumApplicationEvent {
  status: HeliumApplicationStatus;
}
