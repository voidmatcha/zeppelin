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

import { describe, expect, it, vi } from 'vitest';

vi.mock('@zeppelin/core', async () => ({
  ...(await import('../../../../core/message-listener/message-listener'))
}));
vi.mock('@zeppelin/services', () => ({
  ConfigurationService: class {},
  MessageService: class {},
  NotebookService: class {},
  NoteStatusService: class {},
  SaveAsService: class {},
  TicketService: class {}
}));
vi.mock('@zeppelin/share', () => ({ NoteCreateComponent: class {}, ShortcutComponent: class {} }));

import { NotebookActionBarComponent } from './action-bar.component';

describe('Personalized mode requests', () => {
  it.each([
    ['true', 'false'],
    ['false', 'true'],
    [undefined, 'true']
  ])('keeps the authoritative %s mode until the server accepts %s', (current, requested) => {
    const updatePersonalizedMode = vi.fn();
    const note = { id: 'note', config: { personalizedMode: current } };
    let onConfirm: (() => void) | undefined;
    const component = Object.assign(Object.create(NotebookActionBarComponent.prototype), {
      note,
      isOwner: true,
      messageService: { updatePersonalizedMode },
      nzModalService: { confirm: (options: { nzOnOk: () => void }) => (onConfirm = options.nzOnOk) }
    }) as NotebookActionBarComponent;
    component.toggleNotePersonalizedMode();
    expect(updatePersonalizedMode).not.toHaveBeenCalled();
    expect(onConfirm).toBeDefined();
    onConfirm!();
    expect(updatePersonalizedMode).toHaveBeenCalledWith('note', requested);
    // A rejected request has no NOTE response: the displayed mode must still match the server.
    expect(note.config.personalizedMode).toBe(current);
  });
});
