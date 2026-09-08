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
package org.apache.zeppelin.notebook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.HashMap;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.InterpreterSettingManager;
import org.apache.zeppelin.interpreter.RemoteInterpreterEventServer;
import org.apache.zeppelin.interpreter.thrift.OutputAppendEvent;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.scheduler.Job.Status;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceCallback;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.socket.ConnectionManager;
import org.apache.zeppelin.socket.NotebookServer;
import org.apache.zeppelin.socket.NotebookSocket;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class NotebookPersonalizedModeTest {
  private final Note note = new Note();
  private final Notebook notebook = mock(Notebook.class);
  private final NotebookServer server = spy(new NotebookServer());
  private final NotebookSocket alice = mock(NotebookSocket.class);
  private final NotebookSocket bob = mock(NotebookSocket.class);
  private final ServiceContext context = new ServiceContext(
      new AuthenticationInfo("alice"), Collections.singleton("alice"));
  private final ServiceCallback<Note> callback = mock(ServiceCallback.class);
  private NotebookService service;
  private RemoteInterpreterEventServer events;
  private Paragraph paragraph;

  @BeforeEach
  void setUp() throws Exception {
    note.setId("note");
    note.setName("mode-test");
    note.setPersonalizedMode(true);
    paragraph = spy(new Paragraph("para", note, null));
    note.getParagraphs().add(paragraph);
    ZeppelinConfiguration conf = mock(ZeppelinConfiguration.class);
    when(conf.getBoolean(
        ZeppelinConfiguration.ConfVars.ZEPPELIN_WEBSOCKET_PARAGRAPH_STATUS_PROGRESS))
        .thenReturn(true);
    AuthorizationService authorization = mock(AuthorizationService.class);
    when(authorization.isWriter(eq("note"), any())).thenReturn(true);
    when(authorization.isRunner(eq("note"), any())).thenReturn(true);
    doAnswer(invocation -> {
      Notebook.NoteProcessor<?> processor = invocation.getArgument(1);
      return processor.process(note);
    }).when(notebook).processNote(eq("note"), any());
    ConnectionManager connections = new ConnectionManager(authorization, conf);
    connections.addNoteConnection("note", alice);
    connections.addNoteConnection("note", bob);
    connections.addUserConnection("alice", alice);
    connections.addUserConnection("bob", bob);
    server.setZeppelinConfiguration(conf);
    server.setNotebook(() -> notebook);
    server.setConnectionManager(connections);
    InterpreterSettingManager manager = mock(InterpreterSettingManager.class);
    when(manager.getRemoteInterpreterProcessListener()).thenReturn(server);
    events = new RemoteInterpreterEventServer(conf, manager);
    when(manager.getInterpreterEventServer()).thenReturn(events);
    when(notebook.getInterpreterSettingManager()).thenReturn(manager);
    service = new NotebookService(notebook, authorization, conf, null);
  }

  @AfterEach
  void tearDown() throws Exception {
    events.stop();
  }

  @Test
  void managedAdmissionRejectsModeChangeAfterCachePressureAndForcedReload() throws Exception {
    ZeppelinConfiguration configuration = spy(ZeppelinConfiguration.load());
    doReturn(1).when(configuration).getNoteCacheThreshold();
    note.setPath("/mode-test");
    note.getParagraphs().clear();
    NoteParser parser = new GsonNoteParser(configuration);
    String saved = parser.toJson(note);
    org.apache.zeppelin.notebook.repo.InMemoryNotebookRepo repo =
        new org.apache.zeppelin.notebook.repo.InMemoryNotebookRepo() {
          @Override
          public Note get(String id, String path, AuthenticationInfo subject)
              throws java.io.IOException {
            return parser.fromJson(id, saved);
          }
        };
    NoteManager manager = new NoteManager(repo, configuration);
    manager.addNote(note, context.getAutheInfo());
    doAnswer(invocation -> {
      Notebook.NoteProcessor<?> processor = invocation.getArgument(1);
      return manager.processNote("note", processor);
    }).when(notebook).processNote(eq("note"), any());
    manager.processNote("note", n -> {
      n.beginParagraphExecution();
      return null;
    });
    try {
      Note pressure = new Note();
      pressure.setId("pressure");
      pressure.setPath("/pressure");
      manager.addNote(pressure, context.getAutheInfo());
      manager.processNote("note", true, n -> n);
      service.updatePersonalizedMode("note", false, context, callback);
      verify(callback).onFailure(any(java.io.IOException.class), eq(context));
      assertTrue(note.isPersonalizedMode());
    } finally {
      note.endParagraphExecution();
    }
    reset(callback);
    manager.processNote("note", true, n -> n);
    service.updatePersonalizedMode("note", false, context, callback);
    verify(callback).onSuccess(any(Note.class), eq(context));
    assertFalse(manager.processNote("note", n -> n).isPersonalizedMode());
  }

  @Test
  void idleModeChangeDrainsPrivateOutputBeforeDiscardingUserCopies() throws Exception {
    Paragraph privateParagraph = paragraph.getUserParagraph("bob");
    privateParagraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "");
    events.appendOutput(new OutputAppendEvent("note", "para", 0, "bob private", null)
        .setUser("bob").setPersonalized(true));
    service.updatePersonalizedMode("note", false, context, callback);
    verify(alice, never()).send(anyString());
    verify(bob).send(anyString());
    verify(callback).onSuccess(note, context);
    assertFalse(note.isPersonalizedMode());
    assertTrue(paragraph.getUserParagraphMap().isEmpty());
    assertEquals(null, paragraph.getReturn());
  }

  @Test
  void modeChangeDrainsFinalOutputQueuedWhileTheFirstDrainCompletes() throws Exception {
    Paragraph privateParagraph = paragraph.getUserParagraph("bob");
    privateParagraph.setStatusWithoutNotification(Status.RUNNING);
    privateParagraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "");
    doAnswer(invocation -> {
      invocation.callRealMethod();
      events.appendOutput(new OutputAppendEvent("note", "para", 0, "final private", null)
          .setUser("bob").setPersonalized(true));
      privateParagraph.setStatusWithoutNotification(Status.FINISHED);
      return null;
    }).when(server).onOutputAppendForUser("note", "para", 0, "first private", "bob", true);
    events.appendOutput(new OutputAppendEvent("note", "para", 0, "first private", null)
        .setUser("bob").setPersonalized(true));
    service.updatePersonalizedMode("note", false, context, callback);
    events.checkpointOutput("note", "para", "bob", "false");
    verify(alice, never()).send(anyString());
    ArgumentCaptor<String> messages = ArgumentCaptor.forClass(String.class);
    verify(bob, org.mockito.Mockito.times(2)).send(messages.capture());
    assertTrue(messages.getAllValues().get(1).contains("final private"));
    assertFalse(note.isPersonalizedMode());
  }

  @Test
  void modeChangeRejectsPendingAndRunningParagraphsInEitherMode() throws Exception {
    for (boolean personalized : new boolean[] {true, false}) {
      note.setPersonalizedMode(personalized);
      Paragraph target = personalized ? paragraph.getUserParagraph("bob") : paragraph;
      for (Status status : new Status[] {Status.PENDING, Status.RUNNING}) {
        target.setStatusWithoutNotification(status);
        reset(callback);
        service.updatePersonalizedMode("note", !personalized, context, callback);
        verify(callback).onFailure(any(java.io.IOException.class), eq(context));
        verify(callback, never()).onSuccess(any(), any());
        assertEquals(personalized, note.isPersonalizedMode());
        reset(callback);
        service.updatePersonalizedMode("note", personalized, context, callback);
        verify(callback).onSuccess(note, context);
      }
      target.setStatusWithoutNotification(Status.FINISHED);
    }
  }

  @Test
  void runAdmissionRejectsModeChangeBeforeParagraphBecomesPending() throws Exception {
    Paragraph target = spy(paragraph.getUserParagraph("alice"));
    paragraph.getUserParagraphMap().put("alice", target);
    doAnswer(invocation -> {
      assertEquals(Status.READY, target.getStatus());
      service.updatePersonalizedMode("note", false, context, callback);
      return true;
    }).when(target).execute(null, false);
    assertTrue(note.run("para", null, false, "alice"));
    verify(callback).onFailure(any(java.io.IOException.class), eq(context));
    assertTrue(note.isPersonalizedMode());
    assertTrue(note.canChangePersonalizedMode());
  }

  @Test
  void serviceReservesModeBeforeSavingAndChoosingExecution() throws Exception {
    Paragraph target = spy(paragraph.getUserParagraph("alice"));
    paragraph.getUserParagraphMap().put("alice", target);
    doReturn(true).when(target).execute(null, false);
    doAnswer(invocation -> {
      service.updatePersonalizedMode("note", false, context, callback);
      return null;
    }).when(notebook).saveNote(eq(note), any());
    assertTrue(service.runParagraph(note, "para", "title", "code", new HashMap<>(),
        new HashMap<>(), null, false, false, context, mock(ServiceCallback.class)));
    verify(callback).onFailure(any(java.io.IOException.class), eq(context));
    assertTrue(note.isPersonalizedMode());
    assertTrue(note.canChangePersonalizedMode());
  }

  @Test
  void genericNoteUpdateCannotChangePersonalizedMode() throws Exception {
    paragraph.getUserParagraph("bob").setStatusWithoutNotification(Status.RUNNING);
    HashMap<String, Object> config = new HashMap<>();
    config.put("personalizedMode", "false");
    service.updateNote("note", "mode-test", config, context, callback);
    assertTrue(note.isPersonalizedMode());
    assertEquals(Status.RUNNING, paragraph.getUserParagraph("bob").getStatus());
  }
  @Test
  void bulkRunReservesModeBeforeItsFirstParagraph() throws Exception {
    java.util.List<java.util.Map<String, Object>> paragraphs = spy(new java.util.ArrayList<>());
    doAnswer(invocation -> {
      service.updatePersonalizedMode("note", false, context, callback);
      return Collections.emptyIterator();
    }).when(paragraphs).iterator();
    service.runAllParagraphs("note", paragraphs, context, mock(ServiceCallback.class));
    verify(callback).onFailure(any(java.io.IOException.class), eq(context));
    assertTrue(note.isPersonalizedMode());
    assertTrue(note.canChangePersonalizedMode());
  }

  @Test
  void wholeNoteRunReservesModeBeforeAnyParagraphIsPending() throws Exception {
    org.apache.zeppelin.notebook.ParagraphJobListener listener =
        mock(org.apache.zeppelin.notebook.ParagraphJobListener.class);
    doAnswer(invocation -> {
      service.updatePersonalizedMode("note", false, context, callback);
      return null;
    }).when(listener).noteRunningStatusChange("note", true);
    note.setParagraphJobListener(listener);
    note.getParagraphs().clear();
    note.runAll(context.getAutheInfo(), true, false, new HashMap<>());
    verify(callback).onFailure(any(java.io.IOException.class), eq(context));
    assertTrue(note.isPersonalizedMode());
    assertTrue(note.canChangePersonalizedMode());
  }

  @Test
  void latePrivateEventsCannotReplaceSharedOutputAfterModeChange() throws Exception {
    paragraph.getUserParagraph("bob");
    service.updatePersonalizedMode("note", false, context, callback);
    paragraph.updateOutputBuffer(0, InterpreterResult.Type.TABLE, "shared keep");
    events.appendOutput(new OutputAppendEvent("note", "para", 0, "private append", null)
        .setUser("bob").setPersonalized(true));
    events.updateOutput(new org.apache.zeppelin.interpreter.thrift.OutputUpdateEvent(
        "note", "para", 0, "TEXT", "private replacement", null)
        .setUser("bob").setPersonalized(true));
    events.updateAllOutput(new org.apache.zeppelin.interpreter.thrift.OutputUpdateAllEvent(
        "note", "para", Collections.singletonList(
            new org.apache.zeppelin.interpreter.thrift.RemoteInterpreterResultMessage(
                "TEXT", "private all"))).setUser("bob").setPersonalized(true));
    events.checkpointOutput("note", "para", "bob", "false");
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
    assertEquals("shared keep", paragraph.getReturn().message().get(0).getData());
    assertEquals(InterpreterResult.Type.TABLE, paragraph.getReturn().message().get(0).getType());
  }

  @Test
  void sharedAndPrivateAppendsForTheSameUserAreNeverBatchedTogether() throws Exception {
    service.updatePersonalizedMode("note", false, context, callback);
    paragraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "");
    events.appendOutput(new OutputAppendEvent("note", "para", 0, "shared first", null)
        .setUser("bob").setPersonalized(false));
    events.appendOutput(new OutputAppendEvent("note", "para", 0, "private late", null)
        .setUser("bob").setPersonalized(true));
    events.appendOutput(new OutputAppendEvent("note", "para", 0, " shared last", null)
        .setUser("bob").setPersonalized(false));
    events.checkpointOutput("note", "para", "bob", "false");
    assertEquals("shared first shared last", paragraph.getReturn().message().get(0).getData());
    ArgumentCaptor<String> messages = ArgumentCaptor.forClass(String.class);
    verify(alice).send(messages.capture());
    assertFalse(messages.getValue().contains("private late"));
    verify(bob).send(anyString());
  }

  @Test
  void legacyEventsFailClosedAfterAnExplicitModeSelection() throws Exception {
    service.updatePersonalizedMode("note", false, context, callback);
    paragraph.setResult(new org.apache.zeppelin.interpreter.InterpreterResult(
        org.apache.zeppelin.interpreter.InterpreterResult.Code.SUCCESS, "keep"));
    events.appendOutput(new OutputAppendEvent("note", "para", 0, "unknown origin", null));
    events.updateOutput(new org.apache.zeppelin.interpreter.thrift.OutputUpdateEvent(
        "note", "para", 0, "TEXT", "unknown origin", null).setUser("bob"));
    events.checkpointOutput("note", "para", "bob");
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
    assertEquals("keep", paragraph.getReturn().message().get(0).getData());
  }

}
