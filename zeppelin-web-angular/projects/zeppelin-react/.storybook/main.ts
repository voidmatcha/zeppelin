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
import type { StorybookConfig } from '@storybook/react-vite';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Stories are a local design workbench; the remote itself still builds with webpack.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  viteFinal: async viteConfig => ({
    ...viteConfig,
    // Same aliases as vitest.config.mts and tsconfig.json.
    resolve: {
      ...viteConfig.resolve,
      alias: [
        {
          find: /^@zeppelin\/notebook-core$/,
          replacement: fromHere('../../zeppelin-notebook-core/src/public-api.ts')
        },
        { find: '@', replacement: fromHere('../src') },
        { find: '@zeppelin/sdk', replacement: fromHere('../../zeppelin-sdk/src') }
      ]
    }
  })
};

export default config;
