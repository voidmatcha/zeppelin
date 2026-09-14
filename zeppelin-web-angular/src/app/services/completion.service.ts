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

import { Injectable } from '@angular/core';
import { editor, languages, Position } from 'monaco-editor';
import { firstValueFrom, from, Subject } from 'rxjs';
import { filter, map, take, takeUntil, timeout } from 'rxjs/operators';

import { MessageListener, MessageListenersManager } from '@zeppelin/core';
import { CompletionItem, CompletionReceived, OP } from '@zeppelin/sdk';

import { MessageService } from './message.service';

@Injectable({
  providedIn: 'root'
})
export class CompletionService extends MessageListenersManager {
  private completionLanguages = ['python', 'scala'];
  private completionItem$ = new Subject<CompletionReceived>();
  private completionReset$ = new Subject<void>();
  private completionRequests = new Map<string, Promise<void>>();
  private completionGeneration = 0;
  private receivers = new WeakMap<editor.ITextModel, string>();
  private bound = false;

  constructor(messageService: MessageService) {
    super(messageService);
    this.__zeppelinMessageListeners$__?.add(
      messageService.closed().subscribe(() => {
        this.resetCompletionRequests();
      })
    );
  }

  override ngOnDestroy(): void {
    this.resetCompletionRequests();
    this.completionReset$.complete();
    super.ngOnDestroy();
  }

  @MessageListener(OP.COMPLETION_LIST)
  onCompletion(data: CompletionReceived): void {
    this.completionItem$.next(data);
  }

  registerAsCompletionReceiver(model: editor.ITextModel, pid: string): void {
    if (this.receivers.has(model)) {
      return;
    }

    if (!this.bound) {
      this.bindMonacoCompletion();
      this.bound = true;
    }

    this.receivers.set(model, pid);
  }

  unregister(model: editor.ITextModel): void {
    this.receivers.delete(model);
  }

  requestCompletion(paragraphId: string, buffer: string, cursor: number): Promise<readonly CompletionItem[]> {
    const previousRequest = this.completionRequests.get(paragraphId);
    const generation = this.completionGeneration;
    const start = () => {
      if (generation !== this.completionGeneration) {
        throw new Error('Completion request was cancelled because the WebSocket disconnected.');
      }
      return this.startCompletionRequest(paragraphId, buffer, cursor);
    };
    const startedRequest = previousRequest ? previousRequest.then(start) : Promise.resolve(start());
    const requestLane = startedRequest.then(({ response }) => response);
    const settledRequest = requestLane.then(
      () => undefined,
      () => undefined
    );

    this.completionRequests.set(paragraphId, settledRequest);
    void settledRequest.then(() => {
      if (this.completionRequests.get(paragraphId) === settledRequest) {
        this.completionRequests.delete(paragraphId);
      }
    });

    return startedRequest.then(({ result }) => result);
  }

  private startCompletionRequest(
    paragraphId: string,
    buffer: string,
    cursor: number
  ): {
    response: Promise<CompletionReceived>;
    result: Promise<readonly CompletionItem[]>;
  } {
    const response = firstValueFrom(
      this.completionItem$.pipe(
        filter(data => data.id === paragraphId),
        take(1),
        takeUntil(this.completionReset$)
      )
    );
    const result = firstValueFrom(
      from(response).pipe(
        timeout(30000),
        map(data => data.completions)
      )
    );
    this.messageService.completion(paragraphId, buffer, cursor);
    return { response, result };
  }

  private resetCompletionRequests(): void {
    this.completionGeneration += 1;
    this.completionRequests.clear();
    this.completionReset$.next();
  }

  private bindMonacoCompletion(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;

    this.completionLanguages.forEach(l => {
      languages.registerCompletionItemProvider(l, {
        provideCompletionItems(model: editor.ITextModel, position: Position) {
          const id = that.getIdForModel(model);
          const word = model.getWordUntilPosition(position);

          if (!id) {
            return { suggestions: [] };
          }

          return that.requestCompletion(id, model.getValue(), model.getOffsetAt(position)).then(completions => ({
            suggestions: completions.map(
              (i): languages.CompletionItem => ({
                kind: languages.CompletionItemKind.Keyword,
                label: i.name,
                insertText: i.name,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn
                }
              })
            )
          }));
        }
      });
    });
  }

  private getIdForModel(model?: editor.ITextModel): string | null {
    if (!model) {
      return null;
    }
    return this.receivers.get(model) ?? null;
  }
}
