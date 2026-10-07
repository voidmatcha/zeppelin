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

import styles from './AssistantScope.module.css';

import type { CSSProperties, HTMLAttributes } from 'react';
import { theme, type GlobalToken } from 'antd';
import { readable } from './contrast';

/**
 * The antd class prefix for the assistant, apart from the host's ng-zorro `ant-` classes. The assistant's CSS names a
 * few antd 5 classes through it (`zeppelin-ai-btn`, `zeppelin-ai-dropdown-menu-…`) to override their focus and colours.
 */
export const ASSISTANT_PREFIX_CLS = 'zeppelin-ai';

/** Zeppelin's own seeds (`@primary-color`, `@border-radius-base`), so antd derives both themes from them. */
export const ASSISTANT_SEED_TOKENS = {
  colorPrimary: '#3071a9',
  borderRadius: 4
} as const;

/**
 * The assistant's design tokens as CSS variables, all derived from the antd theme the host resolved.
 * Components style themselves only through these, so light and dark need no per-component rules.
 */
export const assistantVariables = (token: GlobalToken): CSSProperties => {
  // AA where antd's palette falls short: text 4.5:1 on the panel and its tints, indicators 3:1 on the panel.
  const panel = token.colorBgContainer;
  const tints = [panel, token.colorFillQuaternary, token.colorPrimaryBg];
  const text = (color: string) => readable(color, tints, 4.5, token.colorTextBase);
  const indicator = (color: string) => readable(color, [panel], 3, token.colorTextBase);
  return {
    '--za-text': token.colorText,
    // antd's control size, which the host's dark reset would otherwise replace with the inherited text size.
    '--za-control-font-size': `${token.fontSize}px`,
    '--za-text-secondary': token.colorTextSecondary,
    '--za-text-tertiary': text(token.colorTextTertiary),
    '--za-bg': token.colorBgContainer,
    '--za-fill': token.colorFillQuaternary,
    '--za-fill-strong': token.colorFillTertiary,
    '--za-border': token.colorBorderSecondary,
    '--za-border-strong': token.colorBorder,
    // The brand fill (marks, the streaming caret); focus rings and selection use --za-focus.
    '--za-accent': token.colorPrimary,
    '--za-focus': indicator(token.colorPrimary),
    // Accent for text on the panel or on --za-accent-bg.
    '--za-accent-text': text(token.colorPrimaryText),
    '--za-accent-text-hover': text(token.colorPrimaryTextHover),
    '--za-accent-bg': token.colorPrimaryBg,
    '--za-accent-border': token.colorPrimaryBorder,
    '--za-success': indicator(token.colorSuccess),
    '--za-success-bg': token.colorSuccessBg,
    '--za-error': token.colorError,
    '--za-error-bg': token.colorErrorBg,
    '--za-warning': indicator(token.colorWarning),
    '--za-warning-bg': token.colorWarningBg,
    '--za-warning-border': token.colorWarningBorder,
    '--za-radius-sm': `${token.borderRadiusSM}px`,
    '--za-radius': `${token.borderRadius}px`,
    '--za-radius-lg': `${token.borderRadiusLG}px`,
    '--za-font': token.fontFamily,
    '--za-font-mono': token.fontFamilyCode,
    '--za-shadow': token.boxShadowTertiary
  } as CSSProperties;
};

export type AssistantScopeProps = HTMLAttributes<HTMLDivElement>;

/** Root of every assistant surface: sets the tokens and the base type. Pieces render correctly only inside it. */
export const AssistantScope = ({ className, style, ...props }: AssistantScopeProps) => {
  const { token } = theme.useToken();
  return (
    <div
      {...props}
      className={className ? `${styles['scope']} ${className}` : styles['scope']}
      style={{ ...assistantVariables(token), ...style }}
    />
  );
};
