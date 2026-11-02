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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.gson.JsonParser;
import java.io.IOException;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceCallback;
import org.apache.zeppelin.service.ServiceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class NotebookServerReloadTest {
  private NotebookServer server;
  private NotebookSocket socket;

  @BeforeEach
  void setUp() throws IOException {
    Note note = new Note();
    note.setId("reload-note");
    NotebookService service = mock(NotebookService.class);
    doAnswer(invocation -> {
      ServiceCallback<Note> callback = invocation.getArgument(3);
      callback.onSuccess(note, invocation.getArgument(2, ServiceContext.class));
      return null;
    }).when(service).getNote(eq(note.getId()), eq(true), any(), any(), isNull());

    ZeppelinConfiguration conf = mock(ZeppelinConfiguration.class);
    when(conf.isAnonymousAllowed()).thenReturn(true);
    server = new NotebookServer();
    server.setZeppelinConfiguration(conf);
    server.setNotebookService(() -> service);
    Notebook notebook = mock(Notebook.class);
    server.setNotebook(() -> notebook);
    server.setConnectionManager(mock(ConnectionManager.class));
    socket = mock(NotebookSocket.class);
    when(socket.getUser()).thenReturn("anonymous");
  }

  @Test
  void reloadReplyCarriesRequestMsgIdForAngularObjectCacheReconciliation() throws IOException {
    server.onMessage(socket,
        new Message(OP.RELOAD_NOTE).withMsgId("reload-1").put("id", "reload-note").toJson());

    Message reply = server.deserializeMessage(onlyReply());
    assertEquals(OP.NOTE, reply.op);
    assertEquals("reload-1", reply.msgId);
  }

  @Test
  void reloadWithoutMsgIdKeepsReplyUncorrelated() throws IOException {
    server.onMessage(socket, new Message(OP.RELOAD_NOTE).put("id", "reload-note").toJson());

    String payload = onlyReply();
    Message reply = server.deserializeMessage(payload);
    assertEquals(OP.NOTE, reply.op);
    assertNull(reply.msgId);
    assertFalse(JsonParser.parseString(payload).getAsJsonObject().has("msgId"));
  }

  private String onlyReply() throws IOException {
    ArgumentCaptor<String> response = ArgumentCaptor.forClass(String.class);
    verify(socket).send(response.capture());
    return response.getValue();
  }
}
