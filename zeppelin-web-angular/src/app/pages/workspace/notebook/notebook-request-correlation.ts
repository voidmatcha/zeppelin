/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { MessageReceiveDataTypeMap, MessageSendDataTypeMap, OP, WebSocketMessage } from '@zeppelin/sdk';

type RequestOp =
  | OP.CHECKPOINT_NOTE
  | OP.GET_INTERPRETER_BINDINGS
  | OP.LIST_REVISION_HISTORY
  | OP.SAVE_INTERPRETER_BINDINGS
  | OP.SET_NOTE_REVISION;
type ResponseOp = OP.INTERPRETER_BINDINGS | OP.LIST_REVISION_HISTORY | OP.SET_NOTE_REVISION;

const responseForRequest: Readonly<Record<RequestOp, ResponseOp>> = {
  [OP.CHECKPOINT_NOTE]: OP.LIST_REVISION_HISTORY,
  [OP.GET_INTERPRETER_BINDINGS]: OP.INTERPRETER_BINDINGS,
  [OP.LIST_REVISION_HISTORY]: OP.LIST_REVISION_HISTORY,
  [OP.SAVE_INTERPRETER_BINDINGS]: OP.INTERPRETER_BINDINGS,
  [OP.SET_NOTE_REVISION]: OP.SET_NOTE_REVISION
};

const trackedRequests = new Set<RequestOp>(Object.keys(responseForRequest) as RequestOp[]);

interface PendingRequest {
  readonly noteId: string;
  readonly responseOp: ResponseOp;
}

export class NotebookRequestCorrelation {
  private readonly pendingByMsgId = new Map<string, PendingRequest>();

  record(message: WebSocketMessage<MessageSendDataTypeMap>): void {
    if (!message.msgId || !trackedRequests.has(message.op as RequestOp)) {
      return;
    }
    const request = message.data as { noteId?: string } | undefined;
    if (!request?.noteId) {
      return;
    }
    const requestOp = message.op as RequestOp;
    this.pendingByMsgId.set(message.msgId, {
      noteId: request.noteId,
      responseOp: responseForRequest[requestOp]
    });
  }

  accept(message: WebSocketMessage<MessageReceiveDataTypeMap>, activeNoteId: string | undefined): boolean {
    if (!message.msgId || !activeNoteId) {
      return false;
    }
    const pending = this.pendingByMsgId.get(message.msgId);
    if (!pending || pending.noteId !== activeNoteId || pending.responseOp !== message.op) {
      return false;
    }
    this.pendingByMsgId.delete(message.msgId);
    return true;
  }
}
