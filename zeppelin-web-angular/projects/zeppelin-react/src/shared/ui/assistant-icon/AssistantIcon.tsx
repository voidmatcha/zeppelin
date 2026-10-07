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

import styles from './AssistantIcon.module.css';
import { useState } from 'react';

// The shell's Zeppelin mark with a separate AI label; the containing button supplies the accessible name.
export const AssistantIcon = () => {
  const [arrival, setArrival] = useState<'loading' | 'intro' | 'ready'>('loading');
  return (
    <span
      className={`${styles['icon']}${arrival === 'intro' ? ` ${styles['icon-arriving']}` : ''}`}
      aria-hidden="true"
      onAnimationEnd={event => {
        if (event.animationName === styles.arrivalAnimation) setArrival('ready');
      }}
    >
      <img
        src="assets/images/zeppelin_svg_logo.svg"
        alt=""
        draggable={false}
        width="28"
        height="18"
        onLoad={() => setArrival(current => (current === 'loading' ? 'intro' : current))}
      />
      <span className={styles['icon-label']}>AI</span>
    </span>
  );
};
