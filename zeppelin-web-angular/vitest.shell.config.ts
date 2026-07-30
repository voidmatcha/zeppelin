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

/**
 * Unit tests for the Angular shell. vitest is installed only in `projects/zeppelin-react`, so `npm run test:shell`
 * invokes that binary directly. This file deliberately exports a plain object rather than calling `defineConfig`,
 * because importing `vitest/config` from here would fail — Node resolves it by walking up from this directory, which
 * has no vitest.
 */

export default {
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.shell.ts']
  }
};
