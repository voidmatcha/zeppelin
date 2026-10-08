/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.apache.zeppelin.socket;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;

import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceCallback;
import org.apache.zeppelin.service.ServiceContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class NotebookServerParagraphBroadcastTest {

  @Test
  void paragraphBroadcastIdentifiesOwningNote() {
    NotebookServer server = new NotebookServer();
    ConnectionManager connections = mock(ConnectionManager.class);
    Note note = mock(Note.class);
    Paragraph paragraph = mock(Paragraph.class);
    when(note.getId()).thenReturn("note-id");
    server.setConnectionManager(connections);

    server.broadcastParagraph(note, paragraph, "paragraph-request");

    ArgumentCaptor<Message> broadcast = ArgumentCaptor.forClass(Message.class);
    verify(connections, atLeastOnce()).broadcast(eq("note-id"), broadcast.capture());
    Message paragraphBroadcast = broadcast.getAllValues().stream()
        .filter(message -> message.op == OP.PARAGRAPH)
        .findFirst()
        .orElseThrow();
    assertEquals("note-id", paragraphBroadcast.get("noteId"));
    assertEquals("paragraph-request", paragraphBroadcast.msgId);
  }

  @Test
  void failedParagraphCommitPreservesRequestMessageId() throws Exception {
    NotebookServer server = new NotebookServer();
    ConnectionManager connections = mock(ConnectionManager.class);
    NotebookService service = mock(NotebookService.class);
    NotebookSocket socket = mock(NotebookSocket.class);
    ServiceContext context = mock(ServiceContext.class);
    server.setConnectionManager(connections);
    server.setNotebookService(() -> service);
    doAnswer(invocation -> {
      ServiceCallback<Paragraph> callback = invocation.getArgument(7);
      callback.onFailure(new IllegalStateException("save failed"), context);
      return null;
    }).when(service).updateParagraph(eq("note-id"), eq("paragraph-id"), eq("title"),
        eq("content"), eq(null), eq(null), eq(context), org.mockito.ArgumentMatchers.any());

    Method update = NotebookServer.class.getDeclaredMethod("updateParagraph", NotebookSocket.class,
        ServiceContext.class, Message.class);
    update.setAccessible(true);
    update.invoke(server, socket, context, new Message(OP.COMMIT_PARAGRAPH)
        .withMsgId("save-request").put("noteId", "note-id")
        .put("id", "paragraph-id").put("title", "title").put("paragraph", "content"));

    ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
    verify(socket).send(sent.capture());
    Message failure = server.deserializeMessage(sent.getValue());
    assertEquals(OP.ERROR_INFO, failure.op);
    assertEquals("save-request", failure.msgId);
  }
}
