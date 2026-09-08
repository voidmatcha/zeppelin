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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.remote.AppendOutputRunner;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.scheduler.Job.Status;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceCallback;
import org.apache.zeppelin.service.ServiceContext;
import java.util.Collections;
import java.lang.reflect.Method;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class NotebookServerOutputTest {
  private NotebookServer server;
  private Note note;
  private Paragraph paragraph;
  private NotebookSocket alice;
  private NotebookSocket bob;
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
    paragraph.setAuthenticationInfo(new AuthenticationInfo("alice"));
    note.getParagraphs().add(paragraph);
    Notebook notebook = mock(Notebook.class);
    doAnswer(invocation -> {
      Notebook.NoteProcessor<?> processor = invocation.getArgument(1);
      return processor.process(note);
    }).when(notebook).processNote(eq("note"), any());
    connections = new ConnectionManager(mock(AuthorizationService.class), conf);
    alice = mock(NotebookSocket.class);
    bob = mock(NotebookSocket.class);
    connections.addNoteConnection("note", alice);
    connections.addNoteConnection("note", bob);
    connections.addUserConnection("alice", alice);
    connections.addUserConnection("bob", bob);
    server = new NotebookServer();
    server.setZeppelinConfiguration(conf);
    server.setNotebook(() -> notebook);
    server.setConnectionManager(connections);
  }

  @Test
  void personalizedAppendDoesNotGuessTheExecutingUser() throws Exception {
    note.setPersonalizedMode(true);
    server.onOutputAppend("note", "para", 0, "alice private output");
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  @Test
  void legacyOutputWarningIsBoundedAndDoesNotExposeOutput() throws Exception {
    org.apache.log4j.Logger logger = org.apache.log4j.Logger.getLogger(NotebookServer.class);
    org.apache.log4j.Level previousLevel = logger.getLevel();
    org.apache.log4j.Appender appender = mock(org.apache.log4j.Appender.class);
    logger.setLevel(org.apache.log4j.Level.WARN);
    logger.addAppender(appender);
    try {
      // Legacy shared notes remain supported and must not consume the warning.
      server.onOutputAppend("note", "para", 0, "supported output");
      verify(appender, never()).doAppend(any());
      note.setPersonalizedMode(false);
      // Modern metadata mismatch is distinct from an unsupported legacy producer.
      server.onOutputAppendForUser("note", "para", 0, "private output", "alice", true);
      verify(appender, never()).doAppend(any());

      java.util.stream.IntStream.range(0, 32).parallel().forEach(index ->
          server.onOutputAppend("note", "para", 0, "secret-output-" + index));
      server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "secret-update");
      server.prepareCheckpointOutput("note", "para", "alice").run();

      ArgumentCaptor<org.apache.log4j.spi.LoggingEvent> events =
          ArgumentCaptor.forClass(org.apache.log4j.spi.LoggingEvent.class);
      verify(appender).doAppend(events.capture());
      String warning = events.getValue().getRenderedMessage();
      assertTrue(warning.contains("execution metadata"));
      assertTrue(warning.contains("Restart"));
      assertTrue(warning.contains("custom output factories"));
      org.junit.jupiter.api.Assertions.assertFalse(warning.contains("secret-"));
      org.junit.jupiter.api.Assertions.assertFalse(warning.contains("alice"));
    } finally {
      logger.removeAppender(appender);
      logger.setLevel(previousLevel);
    }
  }

  @Test
  void modeChangeAfterSelectingPrivateOutputCannotBroadcastIt() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph privateParagraph = spy(paragraph.getUserParagraph("alice"));
    paragraph.addUser(privateParagraph, "alice");
    doAnswer(invocation -> {
      note.setPersonalizedMode(false);
      return invocation.callRealMethod();
    }).when(privateParagraph).appendOutputBuffer(0, "private chunk");

    server.onOutputAppendForUser("note", "para", 0, "private chunk", "alice", true);

    verify(alice).send(contains("private chunk"));
    verify(bob, never()).send(anyString());
  }

  @Test
  void sharedAppendStillReachesAllNoteViewers() throws Exception {
    server.onOutputAppend("note", "para", 0, "shared output");
    verify(alice).send(anyString());
    verify(bob).send(anyString());
  }

  @Test
  void personalizedAppendWithoutOwnerIsNotBroadcast() throws Exception {
    note.setPersonalizedMode(true);
    note.getParagraphs().clear();
    note.getParagraphs().add(new Paragraph("para", note, null));
    server.onOutputAppend("note", "para", 0, "unowned output");
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  @Test
  void removedParagraphOutputIsIgnored() throws Exception {
    note.getParagraphs().clear();
    assertDoesNotThrow(() -> {
      server.onOutputAppend("note", "para", 0, "late append");
      server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "late update");
      server.onOutputClear("note", "para");
    });
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  @Test
  void clearMarksParagraphSnapshotWithoutEndingRun() throws Exception {
    paragraph.setStatus(Status.RUNNING);
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "old output"));
    server.onOutputClear("note", "para");
    ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
    verify(alice, org.mockito.Mockito.atLeastOnce()).send(sent.capture());
    JsonObject cleared = sent.getAllValues().stream().map(this::message)
        .filter(msg -> "PARAGRAPH".equals(msg.get("op").getAsString()))
        .findFirst().orElseThrow();
    JsonObject data = cleared.getAsJsonObject("data");
    assertTrue(data.get("outputCleared").getAsBoolean());
    assertEquals("RUNNING", data.getAsJsonObject("paragraph").get("status").getAsString());
    assertNull(paragraph.getReturn());
  }

  @Test
  void manualClearSignalsRunningViewersAndPreservesRequestId() throws Exception {
    manualClear(false);
  }

  @Test
  void manualPersonalizedClearOnlySignalsTheRequestingUser() throws Exception {
    manualClear(true);
  }

  private void manualClear(boolean personalized) throws Exception {
    note.setPersonalizedMode(personalized);
    Paragraph target = personalized ? paragraph.getUserParagraph("alice") : paragraph;
    target.setStatus(Status.RUNNING);
    target.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "old output"));
    if (personalized) {
      paragraph.getUserParagraph("bob").setResult(
          new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob keep"));
    }
    NotebookService service = mock(NotebookService.class);
    ServiceContext context = new ServiceContext(new AuthenticationInfo("alice"),
        Collections.singleton("alice"));
    doAnswer(invocation -> {
      note.clearParagraphOutputFields(target, true);
      ServiceCallback<Paragraph> callback = invocation.getArgument(3);
      callback.onSuccess(target, context);
      return null;
    }).when(service).clearParagraphOutput(eq("note"), eq("para"), eq(context), any());
    server.setNotebookService(() -> service);
    Method clear = NotebookServer.class.getDeclaredMethod("clearParagraphOutput",
        NotebookSocket.class, ServiceContext.class, Message.class);
    clear.setAccessible(true);
    clear.invoke(server, alice, context,
        new Message(Message.OP.PARAGRAPH_CLEAR_OUTPUT).withMsgId("clear-request").put("id", "para"));
    ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
    verify(alice, org.mockito.Mockito.atLeastOnce()).send(sent.capture());
    JsonObject cleared = sent.getAllValues().stream().map(this::message)
        .filter(msg -> "PARAGRAPH".equals(msg.get("op").getAsString()))
        .findFirst().orElseThrow();
    JsonObject data = cleared.getAsJsonObject("data");
    assertNotNull(data.get("outputCleared"), "manual clear must reset the streaming view");
    assertTrue(data.get("outputCleared").getAsBoolean());
    assertTrue(data.get("preserveOutputTypes").getAsBoolean());
    assertEquals("clear-request", cleared.get("msgId").getAsString());
    assertEquals("RUNNING", data.getAsJsonObject("paragraph").get("status").getAsString());
    assertNull(target.getReturn());
    if (personalized) {
      verify(bob, never()).send(anyString());
      assertEquals("bob keep", paragraph.getUserParagraph("bob")
          .getReturn().message().get(0).getData());
    } else {
      verify(bob, org.mockito.Mockito.atLeastOnce()).send(anyString());
    }
  }

  @Test
  void personalizedEventsDoNotMutateOrDeliverAnotherUsersOutput() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph aliceParagraph = paragraph.getUserParagraph("alice");
    Paragraph bobParagraph = paragraph.getUserParagraph("bob");
    aliceParagraph.setAuthenticationInfo(new AuthenticationInfo("alice"));
    bobParagraph.setAuthenticationInfo(new AuthenticationInfo("bob"));
    aliceParagraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "alice keep"));
    bobParagraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob keep"));
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "master keep"));
    // The master still belongs to Alice while Bob executes his personalized copy.
    bobParagraph.setStatus(Status.RUNNING);
    server.onOutputAppend("note", "para", 0, "bob private append");
    server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "bob private update");
    server.onOutputClear("note", "para");
    server.checkpointOutput("note", "para");

    assertEquals("alice keep", aliceParagraph.getReturn().message().get(0).getData());
    assertEquals("bob keep", bobParagraph.getReturn().message().get(0).getData());
    assertEquals("master keep", paragraph.getReturn().message().get(0).getData());
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
    verify(server.getNotebook(), never()).saveNote(any(), any());
  }

  @Test
  void personalizedSnapshotsStillDeliverEachUsersOwnResult() throws Exception {
    note.setPersonalizedMode(true);
    paragraph.getUserParagraph("alice").setResult(
        new InterpreterResult(InterpreterResult.Code.SUCCESS, "alice result"));
    paragraph.getUserParagraph("bob").setResult(
        new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob result"));
    server.broadcastParagraph(note, paragraph, null);

    assertEquals("alice result", paragraphResultSentTo(alice));
    assertEquals("bob result", paragraphResultSentTo(bob));
  }

  @Test
  void personalizedStreamingAndCheckpointsStayWithTheirExecutionOwner() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph aliceParagraph = paragraph.getUserParagraph("alice");
    Paragraph bobParagraph = paragraph.getUserParagraph("bob");
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "shared keep"));
    server.onOutputUpdatedForUser("note", "para", 0, InterpreterResult.Type.TEXT,
        "alice update", "alice", note.isPersonalizedMode());
    server.onOutputUpdatedForUser("note", "para", 0, InterpreterResult.Type.TEXT,
        "bob update", "bob", note.isPersonalizedMode());
    server.onOutputAppendForUser("note", "para", 0, "alice append", "alice", note.isPersonalizedMode());
    server.onOutputAppendForUser("note", "para", 0, "bob append", "bob", note.isPersonalizedMode());
    server.prepareCheckpointOutput("note", "para", "alice", true).run();
    server.prepareCheckpointOutput("note", "para", "bob", true).run();
    assertEquals("alice updatealice append", aliceParagraph.getReturn().message().get(0).getData());
    assertEquals("bob updatebob append", bobParagraph.getReturn().message().get(0).getData());
    assertEquals("shared keep", paragraph.getReturn().message().get(0).getData());
    ArgumentCaptor<String> aliceMessages = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<String> bobMessages = ArgumentCaptor.forClass(String.class);
    verify(alice, org.mockito.Mockito.times(2)).send(aliceMessages.capture());
    verify(bob, org.mockito.Mockito.times(2)).send(bobMessages.capture());
    assertTrue(aliceMessages.getAllValues().stream().noneMatch(msg -> msg.contains("bob")));
    assertTrue(bobMessages.getAllValues().stream().noneMatch(msg -> msg.contains("alice")));
    server.onOutputClearForUser("note", "para", "bob", note.isPersonalizedMode());
    assertNull(bobParagraph.getReturn());
    assertEquals("alice updatealice append", aliceParagraph.getReturn().message().get(0).getData());
    verify(server.getNotebook(), never()).saveNote(any(), any());
  }

  @Test
  void unknownExecutionOwnerDoesNotCreateAPersonalizedCopy() throws Exception {
    note.setPersonalizedMode(true);
    server.onOutputUpdatedForUser("note", "para", 0, InterpreterResult.Type.TEXT,
        "private", "missing", note.isPersonalizedMode());
    server.onOutputAppendForUser("note", "para", 0, "private", "missing", note.isPersonalizedMode());
    server.onOutputClearForUser("note", "para", "missing", note.isPersonalizedMode());
    server.prepareCheckpointOutput("note", "para", "missing", true).run();
    assertTrue(paragraph.getUserParagraphMap().isEmpty());
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
    verify(server.getNotebook(), never()).saveNote(any(), any());
  }

  @Test
  void slowRepositorySaveDoesNotHoldTheOutputDrainMonitor() throws Exception {
    Paragraph other = new Paragraph("other", note, null);
    note.getParagraphs().add(other);
    CountDownLatch saving = new CountDownLatch(1);
    CountDownLatch releaseSave = new CountDownLatch(1);
    doAnswer(invocation -> {
      saving.countDown();
      assertTrue(releaseSave.await(5, TimeUnit.SECONDS));
      return null;
    }).when(server.getNotebook()).saveNote(eq(note), any());
    AppendOutputRunner runner = new AppendOutputRunner(server);
    runner.updateBuffer("note", "para", 0, InterpreterResult.Type.TEXT, "checkpoint value");
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> checkpoint = executor.submit(() -> runner.checkpointOutput("note", "para"));
      assertTrue(saving.await(5, TimeUnit.SECONDS));
      assertEquals("checkpoint value", paragraph.getReturn().message().get(0).getData());
      runner.updateBuffer("note", "other", 0, InterpreterResult.Type.TEXT, "live other");
      executor.submit(runner).get(2, TimeUnit.SECONDS);
      other.checkpointOutput();
      assertEquals("live other", other.getReturn().message().get(0).getData());
      org.junit.jupiter.api.Assertions.assertFalse(checkpoint.isDone());
      releaseSave.countDown();
      checkpoint.get(5, TimeUnit.SECONDS);
    } finally {
      releaseSave.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void delayedPersonalizedCheckpointCannotReplaceSharedTerminalOutput() throws Exception {
    note.setPersonalizedMode(true);
    paragraph.getUserParagraph("bob").updateOutputBuffer(
        0, InterpreterResult.Type.TEXT, "private output");
    note.setPersonalizedMode(false);
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "shared result"));

    server.prepareCheckpointOutput("note", "para", "bob", true).run();
    // Missing metadata must also fail closed after any explicit mode selection.
    server.prepareCheckpointOutput("note", "para", "bob").run();

    assertEquals("shared result", paragraph.getReturn().message().get(0).getData());
    verify(server.getNotebook(), never()).saveNote(any(), any());
  }

  @Test
  void delayedSharedCheckpointCannotReplacePersonalizedOutput() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph copy = paragraph.getUserParagraph("alice");
    copy.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "private result"));

    server.prepareCheckpointOutput("note", "para", "alice", false).run();

    assertEquals("private result", copy.getReturn().message().get(0).getData());
    verify(server.getNotebook(), never()).saveNote(any(), any());
  }

  @Test
  void currentSharedCheckpointStillPersistsAfterSwitchingModes() throws Exception {
    note.setPersonalizedMode(true);
    note.setPersonalizedMode(false);
    paragraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "current shared output");

    server.prepareCheckpointOutput("note", "para", "alice", false).run();

    assertEquals("current shared output", paragraph.getReturn().message().get(0).getData());
    verify(server.getNotebook()).saveNote(eq(note), any());
  }

  @Test
  void sharedCheckpointIncludesAppendsAndDoesNotInventMissingSlotTypes() {
    server.onOutputAppend("note", "para", 3, "untyped");
    server.onOutputAppend("note", "para", -1, "invalid");
    server.prepareCheckpointOutput("note", "para", null).run();
    assertTrue(paragraph.getReturn().message().isEmpty());
    server.onOutputUpdated("note", "para", 0, InterpreterResult.Type.TABLE, "name\n");
    server.onOutputAppend("note", "para", 0, "alice\n");
    server.prepareCheckpointOutput("note", "para", null).run();
    assertEquals(InterpreterResult.Type.TABLE, paragraph.getReturn().message().get(0).getType());
    assertEquals("name\nalice\n", paragraph.getReturn().message().get(0).getData());
  }

  @Test
  void blankOwnerCannotFallBackToTheMasterUser() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph aliceParagraph = paragraph.getUserParagraph("alice");
    aliceParagraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "keep"));
    server.onOutputUpdatedForUser("note", "para", 0, InterpreterResult.Type.TEXT, "bad", "", note.isPersonalizedMode());
    server.onOutputAppendForUser("note", "para", 0, "bad", "", note.isPersonalizedMode());
    server.onOutputClearForUser("note", "para", "", note.isPersonalizedMode());
    server.prepareCheckpointOutput("note", "para", "", true).run();
    assertEquals("keep", aliceParagraph.getReturn().message().get(0).getData());
    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  @Test
  void checkpointProtectsTheCapturedNoteFromEvictionUntilSaveCompletes() throws Exception {
    assertCheckpointEvictionProtection(false);
  }

  @Test
  void failedCheckpointSaveReleasesEvictionProtection() throws Exception {
    assertCheckpointEvictionProtection(true);
  }

  private void assertCheckpointEvictionProtection(boolean failSave) throws Exception {
    ExecutorService evictionThread = Executors.newSingleThreadExecutor();
    try {
      doAnswer(invocation -> {
        org.junit.jupiter.api.Assertions.assertFalse(
            evictionThread.submit(this::tryEvictionLock).get(5, TimeUnit.SECONDS));
        if (failSave) {
          throw new java.io.IOException("repository unavailable");
        }
        return null;
      }).when(server.getNotebook()).saveNote(eq(note), any());
      Runnable persist = server.prepareCheckpointOutput("note", "para", null);
      org.junit.jupiter.api.Assertions.assertFalse(
          evictionThread.submit(this::tryEvictionLock).get(5, TimeUnit.SECONDS));
      persist.run();
      assertTrue(evictionThread.submit(this::tryEvictionLock).get(5, TimeUnit.SECONDS));
      verify(server.getNotebook()).saveNote(eq(note), any());
    } finally {
      evictionThread.shutdownNow();
      // Ensure a failed assertion does not retain a read lock on the test's caller thread.
      while (note.getLock().getReadHoldCount() > 0) {
        note.getLock().readLock().unlock();
      }
    }
  }

  private boolean tryEvictionLock() {
    if (!note.getLock().writeLock().tryLock()) {
      return false;
    }
    note.getLock().writeLock().unlock();
    return true;
  }

  @Test
  void websocketClearAllDrainsSharedOutputAndResumesTypedAppends() throws Exception {
    websocketClearAll(false);
  }

  @Test
  void websocketClearAllOnlyClearsAndSignalsTheRequestingPersonalizedUser() throws Exception {
    websocketClearAll(true);
  }

  private void websocketClearAll(boolean personalized) throws Exception {
    when(alice.getUser()).thenReturn("alice");
    note.setPersonalizedMode(personalized);
    Paragraph second = new Paragraph("second", note, null);
    second.setAuthenticationInfo(new AuthenticationInfo("alice"));
    note.getParagraphs().add(second);
    Paragraph firstTarget = personalized ? paragraph.getUserParagraph("alice") : paragraph;
    Paragraph secondTarget = personalized ? second.getUserParagraph("alice") : second;
    firstTarget.setStatus(Status.RUNNING);
    secondTarget.setStatus(Status.RUNNING);
    firstTarget.updateOutputBuffer(0, InterpreterResult.Type.TABLE, "old table");
    secondTarget.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "old text");
    Paragraph unexecuted = null;
    if (personalized) {
      paragraph.getUserParagraph("bob").updateOutputBuffer(
          0, InterpreterResult.Type.TEXT, "bob keep");
      paragraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "master keep");
      unexecuted = new Paragraph("unexecuted", note, null);
      unexecuted.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "shared visible"));
      note.getParagraphs().add(unexecuted);
      unexecuted.getUserParagraph("bob").setResult(
          new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob visible"));
    }
    ZeppelinConfiguration conf = mock(ZeppelinConfiguration.class);
    when(conf.getBoolean(
        ZeppelinConfiguration.ConfVars.ZEPPELIN_WEBSOCKET_PARAGRAPH_STATUS_PROGRESS))
        .thenReturn(true);
    server.setZeppelinConfiguration(conf);
    AuthorizationService authorization = mock(AuthorizationService.class);
    when(authorization.isWriter(eq("note"), any())).thenReturn(true);
    org.apache.zeppelin.interpreter.InterpreterSettingManager manager =
        mock(org.apache.zeppelin.interpreter.InterpreterSettingManager.class);
    when(manager.getRemoteInterpreterProcessListener()).thenReturn(server);
    org.apache.zeppelin.interpreter.RemoteInterpreterEventServer events =
        new org.apache.zeppelin.interpreter.RemoteInterpreterEventServer(conf, manager);
    when(manager.getInterpreterEventServer()).thenReturn(events);
    when(server.getNotebook().getInterpreterSettingManager()).thenReturn(manager);
    NotebookService service = new NotebookService(server.getNotebook(), authorization, conf, null);
    server.setNotebookService(() -> service);
    String ticket = org.apache.zeppelin.ticket.TicketContainer.instance
        .getTicket("alice", Collections.emptySet());
    try {
      events.appendOutput(new org.apache.zeppelin.interpreter.thrift.OutputAppendEvent(
          "note", "para", 0, " queued before clear", null).setUser("alice").setPersonalized(personalized));
      Message clear = new Message(Message.OP.PARAGRAPH_CLEAR_ALL_OUTPUT)
          .withMsgId("clear-all-request").put("id", "note").put("noteId", "note");
      clear.principal = "alice";
      clear.ticket = ticket;
      server.onMessage(alice, clear.toJson());
      events.checkpointOutput("note", "para", "alice", Boolean.toString(personalized));
      secondTarget.checkpointOutput();
      assertEquals("", firstTarget.getReturn().message().get(0).getData());
      assertEquals("", secondTarget.getReturn().message().get(0).getData());
      ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
      verify(alice, org.mockito.Mockito.atLeastOnce()).send(sent.capture());
      java.util.List<JsonObject> snapshots = sent.getAllValues().stream().map(this::message)
          .filter(msg -> "PARAGRAPH".equals(msg.get("op").getAsString()))
          .collect(java.util.stream.Collectors.toList());
      assertEquals(personalized ? 3 : 2, snapshots.size());
      for (JsonObject snapshot : snapshots) {
        assertEquals("clear-all-request", snapshot.get("msgId").getAsString());
        JsonObject data = snapshot.getAsJsonObject("data");
        assertTrue(data.get("outputCleared").getAsBoolean());
        assertTrue(data.get("preserveOutputTypes").getAsBoolean());
        JsonObject clearedParagraph = data.getAsJsonObject("paragraph");
        assertEquals("unexecuted".equals(clearedParagraph.get("id").getAsString())
            ? "READY" : "RUNNING", clearedParagraph.get("status").getAsString());
      }
      assertTrue(sent.getAllValues().stream().map(this::message)
          .noneMatch(msg -> "NOTE".equals(msg.get("op").getAsString())));
      events.appendOutput(new org.apache.zeppelin.interpreter.thrift.OutputAppendEvent(
          "note", "para", 0, "new table", null).setUser("alice").setPersonalized(personalized));
      events.checkpointOutput("note", "para", "alice", Boolean.toString(personalized));
      assertEquals(InterpreterResult.Type.TABLE,
          firstTarget.getReturn().message().get(0).getType());
      assertEquals("new table", firstTarget.getReturn().message().get(0).getData());
      if (personalized) {
        verify(bob, never()).send(anyString());
        assertNotNull(unexecuted.getUserParagraphMap().get("alice"));
        assertNull(unexecuted.getUserParagraphMap().get("alice").getReturn());
        assertEquals("shared visible", unexecuted.getReturn().message().get(0).getData());
        assertEquals("bob visible", unexecuted.getUserParagraph("bob")
            .getReturn().message().get(0).getData());
        paragraph.getUserParagraph("bob").checkpointOutput();
        paragraph.checkpointOutput();
        assertEquals("bob keep", paragraph.getUserParagraph("bob")
            .getReturn().message().get(0).getData());
        assertEquals("master keep", paragraph.getReturn().message().get(0).getData());
        verify(server.getNotebook(), never()).saveNote(any(), any());
      } else {
        verify(bob, org.mockito.Mockito.atLeastOnce()).send(anyString());
      }
    } finally {
      org.apache.zeppelin.ticket.TicketContainer.instance.removeTicket("alice");
      events.stop();
    }
  }

  @Test
  void personalizedOutputAndSnapshotsStayInTheOwningNoteForTheSameUser() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph target = paragraph.getUserParagraph("alice");
    target.setStatus(Status.RUNNING);
    // Cloned notes retain paragraph IDs, so user-only multicasts cannot distinguish their views.
    Note clonedNote = new Note();
    clonedNote.setId("cloned-note");
    clonedNote.getParagraphs().add(new Paragraph("para", clonedNote, null));
    NotebookSocket clonedView = mock(NotebookSocket.class);
    connections.addNoteConnection(clonedNote.getId(), clonedView);
    connections.addUserConnection("alice", clonedView);

    server.onOutputUpdatedForUser("note", "para", 0,
        InterpreterResult.Type.TEXT, "private", "alice", note.isPersonalizedMode());
    server.onOutputAppendForUser("note", "para", 0, " append", "alice", note.isPersonalizedMode());
    server.onOutputClearForUser("note", "para", "alice", note.isPersonalizedMode());
    server.broadcastParagraph(note, paragraph, "server-snapshot");
    connections.unicastParagraph(note, target, "alice", "run-snapshot");
    connections.broadcastParagraphs(paragraph.getUserParagraphMap());

    verify(clonedView, never()).send(anyString());
    ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
    verify(alice, org.mockito.Mockito.atLeastOnce()).send(sent.capture());
    java.util.List<JsonObject> output = sent.getAllValues().stream().map(this::message)
        .filter(msg -> msg.get("op").getAsString().startsWith("PARAGRAPH"))
        .collect(java.util.stream.Collectors.toList());
    assertEquals(6, output.size());
    assertTrue(output.stream().allMatch(msg ->
        "note".equals(msg.getAsJsonObject("data").get("noteId").getAsString())));
    assertTrue(output.stream().anyMatch(msg ->
        "PARAGRAPH_UPDATE_OUTPUT".equals(msg.get("op").getAsString())));
    assertTrue(output.stream().anyMatch(msg ->
        "PARAGRAPH_APPEND_OUTPUT".equals(msg.get("op").getAsString())));
    assertTrue(output.stream().anyMatch(msg ->
        msg.getAsJsonObject("data").has("outputCleared")));
  }

  @Test
  void detachedPersonalizedTerminalSnapshotIsNotBroadcastAfterDisablingTheMode() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph oldBob = paragraph.getUserParagraph("bob");
    oldBob.setAuthenticationInfo(new AuthenticationInfo("bob"));
    oldBob.setStatus(Status.FINISHED);
    oldBob.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob private result"));
    note.setPersonalizedMode(false);

    server.broadcastParagraph(note, oldBob, "late-terminal");

    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  @Test
  void replacementPersonalizedCopyInvalidatesTheOldTerminalSnapshot() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph oldBob = paragraph.getUserParagraph("bob");
    oldBob.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "old bob private"));
    paragraph.cloneParagraphForUser("bob");

    server.broadcastParagraph(note, oldBob, "old-copy");

    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  @Test
  void registeredPersonalizedSnapshotUsesMapOwnershipInsteadOfInheritedAuthentication()
      throws Exception {
    note.setPersonalizedMode(true);
    // A newly cloned paragraph initially inherits Alice's authentication from the master.
    Paragraph bobCopy = paragraph.getUserParagraph("bob");
    bobCopy.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob own result"));

    server.broadcastParagraph(note, bobCopy, "current-copy");

    verify(alice, never()).send(anyString());
    assertEquals("bob own result", paragraphResultSentTo(bob));
  }

  @Test
  void sharedMasterWithAuthenticationStillBroadcastsItsSnapshot() throws Exception {
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "shared result"));

    server.broadcastParagraph(note, paragraph, "shared-master");

    assertEquals("shared result", paragraphResultSentTo(alice));
    assertEquals("shared result", paragraphResultSentTo(bob));
  }

  @Test
  void websocketRunCallbackPreservesTypedOutputAlreadyEmittedByTheInterpreter() throws Exception {
    note.setPersonalizedMode(true);
    when(alice.getUser()).thenReturn("alice");
    Paragraph target = paragraph.getUserParagraph("alice");
    target.setAuthenticationInfo(new AuthenticationInfo("alice"));
    target.setStatus(Status.RUNNING);
    paragraph.getUserParagraph("bob").setResult(
        new InterpreterResult(InterpreterResult.Code.SUCCESS, "bob keep"));
    NotebookService service = mock(NotebookService.class);
    doAnswer(invocation -> {
      server.onOutputUpdatedForUser("note", "para", 0,
          InterpreterResult.Type.TABLE, "first typed output", "alice", note.isPersonalizedMode());
      ServiceCallback<Paragraph> callback = invocation.getArgument(10);
      callback.onSuccess(target, invocation.getArgument(9));
      return true;
    }).when(service).runParagraph(eq(note), eq("para"), any(), any(), any(), any(), any(),
        eq(false), eq(false), any(), any());
    server.setNotebookService(() -> service);
    String ticket = org.apache.zeppelin.ticket.TicketContainer.instance
        .getTicket("alice", Collections.emptySet());
    try {
      Message run = new Message(Message.OP.RUN_PARAGRAPH).withMsgId("fast-run")
          .put("id", "para").put("noteId", "note");
      run.principal = "alice";
      run.ticket = ticket;
      server.onMessage(alice, run.toJson());
      verify(service).runParagraph(eq(note), eq("para"), any(), any(), any(), any(), any(),
          eq(false), eq(false), any(), any());
      server.onOutputAppendForUser("note", "para", 0, " later append", "alice", note.isPersonalizedMode());
      server.prepareCheckpointOutput("note", "para", "alice", true).run();
      assertEquals(InterpreterResult.Type.TABLE, target.getReturn().message().get(0).getType());
      assertEquals("first typed output later append",
          target.getReturn().message().get(0).getData());
      verify(bob, never()).send(anyString());
      assertEquals("bob keep", paragraph.getUserParagraph("bob")
          .getReturn().message().get(0).getData());
      ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
      verify(alice, org.mockito.Mockito.atLeastOnce()).send(sent.capture());
      assertTrue(sent.getAllValues().stream().map(this::message)
          .anyMatch(msg -> "PARAGRAPH".equals(msg.get("op").getAsString())
              && "fast-run".equals(msg.get("msgId").getAsString())));
    } finally {
      org.apache.zeppelin.ticket.TicketContainer.instance.removeTicket("alice");
    }
  }

  @Test
  void connectionManagerDoesNotBroadcastADetachedPersonalizedCopyAsShared() throws Exception {
    note.setPersonalizedMode(true);
    Paragraph oldBob = paragraph.getUserParagraph("bob");
    oldBob.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, "private old result"));
    note.setPersonalizedMode(false);

    connections.broadcastParagraph(note, oldBob);

    verify(alice, never()).send(anyString());
    verify(bob, never()).send(anyString());
  }

  private String paragraphResultSentTo(NotebookSocket socket) throws Exception {
    ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
    verify(socket, org.mockito.Mockito.atLeastOnce()).send(sent.capture());
    JsonObject snapshot = sent.getAllValues().stream().map(this::message)
        .filter(msg -> "PARAGRAPH".equals(msg.get("op").getAsString()))
        .findFirst().orElseThrow();
    return snapshot.getAsJsonObject("data").getAsJsonObject("paragraph")
        .getAsJsonObject("results").getAsJsonArray("msg").get(0).getAsJsonObject()
        .get("data").getAsString();
  }

  private JsonObject message(String json) {
    return JsonParser.parseString(json).getAsJsonObject();
  }
}
