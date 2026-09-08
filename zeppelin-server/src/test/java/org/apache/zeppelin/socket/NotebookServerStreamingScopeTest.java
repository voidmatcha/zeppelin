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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.util.Collections;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceCallback;
import org.apache.zeppelin.service.ServiceContext;
import org.mockito.ArgumentCaptor;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class NotebookServerStreamingScopeTest {
  private NotebookServer server;
  private Notebook notebook;
  private Note note;
  private Paragraph paragraph;
  private ConnectionManager connections;

  @BeforeEach
  void setUp() throws Exception {
    ZeppelinConfiguration conf = mock(ZeppelinConfiguration.class);
    when(conf.getBoolean(
        ZeppelinConfiguration.ConfVars.ZEPPELIN_WEBSOCKET_PARAGRAPH_STATUS_PROGRESS))
        .thenReturn(true);
    note = new Note();
    note.setId("note");
    paragraph = new Paragraph("para", note, null);
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "saved"));
    note.getParagraphs().add(paragraph);
    notebook = mock(Notebook.class);
    doAnswer(invocation -> {
      Notebook.NoteProcessor<?> processor = invocation.getArgument(1);
      return processor.process(note);
    }).when(notebook).processNote(eq("note"), any());
    connections = mock(ConnectionManager.class);
    server = new NotebookServer();
    server.setZeppelinConfiguration(conf);
    server.setNotebook(() -> notebook);
    server.setConnectionManager(connections);
  }

  @Test
  void sharedOutputIsDeliveredAndCheckpointed() throws Exception {
    server.onOutputAppend("note", "para", 0, "append");
    server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "updated");
    server.checkpointOutput("note", "para");
    verify(connections, org.mockito.Mockito.times(2)).broadcast(eq("note"), any());
    assertEquals("updated", paragraph.getReturn().message().get(0).getData());
    verify(notebook).saveNote(note, AuthenticationInfo.ANONYMOUS);
  }

  @Test
  void personalOutputCannotBeBroadcastOrPersistedOnSharedParagraph() throws Exception {
    note.setPersonalizedMode(true);
    assertSuppressed();
  }

  @Test
  void delayedPersonalOutputRemainsSuppressedAfterSwitchToShared() throws Exception {
    note.setPersonalizedMode(true);
    note.setPersonalizedMode(false);
    assertSuppressed();
  }

  @Test
  void explicitSharedSettingIsConservativelySuppressedAfterReload() throws Exception {
    note.getConfig().put("personalizedMode", "false");
    assertSuppressed();
  }

  @Test
  void staleClientConfigCannotReenableDelayedPersonalOutput() throws Exception {
    note.setPersonalizedMode(true);
    note.setConfig(java.util.Collections.singletonMap("looknfeel", "default"));
    assertEquals("true", note.getConfig().get("personalizedMode"));
    assertSuppressed();
  }

  @Test
  void staleClientConfigCannotRemoveExplicitSharedRestriction() throws Exception {
    note.setPersonalizedMode(true);
    note.setPersonalizedMode(false);
    note.setConfig(java.util.Collections.emptyMap());
    assertEquals("false", note.getConfig().get("personalizedMode"));
    assertSuppressed();
  }

  @Test
  void settingsReplyIncludesThePreservedPersonalizedMode() throws Exception {
    note.setPersonalizedMode(true);
    NotebookService service = mock(NotebookService.class);
    ServiceContext context = new ServiceContext(new AuthenticationInfo("alice"),
        Collections.singleton("alice"));
    doAnswer(invocation -> {
      note.setConfig(invocation.getArgument(2));
      ServiceCallback<Note> callback = invocation.getArgument(4);
      callback.onSuccess(note, context);
      return null;
    }).when(service).updateNote(eq("note"), eq("name"), any(), eq(context), any());
    server.setNotebookService(() -> service);
    Method update = NotebookServer.class.getDeclaredMethod("updateNote", NotebookSocket.class,
        ServiceContext.class, Message.class);
    update.setAccessible(true);
    update.invoke(server, mock(NotebookSocket.class), context,
        new Message(Message.OP.NOTE_UPDATE).put("id", "note").put("name", "name")
            .put("config", Collections.emptyMap()));
    ArgumentCaptor<Message> reply = ArgumentCaptor.forClass(Message.class);
    verify(connections).broadcast(eq("note"), reply.capture());
    assertEquals(note.getConfig(), reply.getValue().get("config"));
  }

  @Test
  void removedParagraphDoesNotBreakOutputDelivery() {
    note.getParagraphs().clear();
    assertDoesNotThrow(() -> {
      server.onOutputAppend("note", "para", 0, "late");
      server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "late");
      server.onOutputClear("note", "para");
      server.checkpointOutput("note", "para");
    });
    verifyNoInteractions(connections);
  }

  private void assertSuppressed() throws Exception {
    InterpreterResult saved = paragraph.getReturn();
    server.onOutputAppend("note", "para", 0, "private append");
    server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "private update");
    server.onOutputClear("note", "para");
    server.checkpointOutput("note", "para");
    verifyNoInteractions(connections);
    verify(notebook, never()).saveNote(any(), any());
    assertEquals(saved, paragraph.getReturn());
    // Suppressed updates must not have contaminated the master's checkpoint buffer.
    paragraph.checkpointOutput();
    assertEquals(0, paragraph.getReturn().message().size());
  }
}
