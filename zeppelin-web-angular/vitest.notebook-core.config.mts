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

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@zeppelin/sdk': fileURLToPath(new URL('./projects/zeppelin-sdk/src/public-api.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: [
      'projects/zeppelin-notebook-core/**/*.spec.ts',
      'src/app/pages/workspace/notebook/notebook-request-correlation.spec.ts',
      'test/notebook-core/**/*.spec.ts'
    ]
  }
});
