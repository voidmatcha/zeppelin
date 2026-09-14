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

import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { removeParagraphAfterConfirmation } from '../../src/app/pages/workspace/notebook/paragraph/paragraph-removal';

describe('removeParagraphAfterConfirmation', () => {
  it('removes the paragraph that opened the confirmation dialog', () => {
    const afterClose = new Subject<boolean>();
    const paragraphRemove = vi.fn();
    const markForCheck = vi.fn();
    const destroy$ = new Subject<void>();

    removeParagraphAfterConfirmation(afterClose, destroy$, 'paragraph-1', paragraphRemove, markForCheck);
    afterClose.next(true);

    expect(paragraphRemove).toHaveBeenCalledOnce();
    expect(paragraphRemove).toHaveBeenCalledWith('paragraph-1');
    expect(markForCheck).toHaveBeenCalledOnce();
  });

  it('ignores cancellation and stops listening after destruction', () => {
    const afterClose = new Subject<boolean | undefined>();
    const destroy$ = new Subject<void>();
    const paragraphRemove = vi.fn();

    removeParagraphAfterConfirmation(afterClose, destroy$, 'paragraph-1', paragraphRemove, vi.fn());
    afterClose.next(undefined);
    destroy$.next();
    afterClose.next(true);

    expect(paragraphRemove).not.toHaveBeenCalled();
  });
});
