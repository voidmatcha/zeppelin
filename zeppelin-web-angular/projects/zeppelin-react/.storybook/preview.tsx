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

import { type ReactNode, useEffect } from 'react';
import type { Decorator, Preview } from '@storybook/react-vite';
import { theme } from 'antd';
import { ASSISTANT_PREFIX_CLS, ASSISTANT_SEED_TOKENS } from '@/shared/ui/assistant-theme';
import { ZeppelinThemeProvider } from '../src/theme';
// What the Angular shell loads globally: highlight.js's github theme and Zeppelin's dark overrides.
import 'highlight.js/styles/github.css';
import '../../../src/styles/theme/dark-theme-overrides.css';

const Canvas = ({ children }: { children: ReactNode }) => {
  const { token } = theme.useToken();
  return (
    <div style={{ minHeight: '100vh', padding: 16, boxSizing: 'border-box', background: token.colorBgLayout }}>
      {children}
    </div>
  );
};

// Stories read the theme the way the remote does inside Zeppelin: from the root `data-theme` the shell writes.
const withHostTheme: Decorator = (Story, context) => {
  const mode = context.globals.theme === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    // The shell writes both, and its dark overrides key off the class.
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, [mode]);
  return (
    <ZeppelinThemeProvider prefixCls={ASSISTANT_PREFIX_CLS} token={ASSISTANT_SEED_TOKENS}>
      <Canvas>
        <Story />
      </Canvas>
    </ZeppelinThemeProvider>
  );
};

const preview: Preview = {
  decorators: [withHostTheme],
  globalTypes: {
    theme: {
      description: 'Zeppelin theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' }
        ],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    options: {
      storySort: {
        order: ['Assistant', ['Introduction', 'Foundations', 'Components', 'Panel']]
      }
    },
    controls: { expanded: true }
  }
};

export default preview;
