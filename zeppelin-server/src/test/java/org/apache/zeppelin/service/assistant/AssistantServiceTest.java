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

package org.apache.zeppelin.service.assistant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.ServiceUnavailableException;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Notebook.NoteProcessor;
import org.apache.zeppelin.rest.exception.NoteNotFoundException;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AssistantServiceTest {
  private final AuthenticationInfo authInfo = new AuthenticationInfo("holden");
  private final AuthenticationInfo otherAuthInfo = new AuthenticationInfo("phoebe");
  private final Set<String> userAndRoles = Set.of("user");

  @Test
  void rejectsUnavailable() {
    var sut = new AssistantService(
        false, null, null, null, null, null
    );

    assertThrows(
        ServiceUnavailableException.class,
        () -> sut.createConversation("noteId", "title", authInfo, userAndRoles)
    );
  }

  @Test
  void rejectsNonReaders() {
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(false);

    var sut = new AssistantService(
        true, null, null, null, authorization, null
    );

    assertThrows(ForbiddenException.class, () -> sut.listConversations("noteId", userAndRoles));
    assertThrows(ForbiddenException.class,
        () -> sut.createConversation("noteId", "title", authInfo, userAndRoles)
    );
    assertThrows(ForbiddenException.class,
        () -> sut.deleteConversation("noteId", "conv", authInfo.getUser(), userAndRoles)
    );
  }

  @Test
  void rejectsAnonymousCreate() {
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var sut = new AssistantService(true, null, null, null, authorization, null);

    assertThrows(
        ForbiddenException.class,
        () -> sut.createConversation("noteId", "title", AuthenticationInfo.ANONYMOUS, userAndRoles)
    );
  }

  @Test
  void createsConversation(@TempDir File tempDir) throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));

    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);

    var repository = new FileConversationRepository(tempDir);
    var sut = new AssistantService(
        true, notebook, null, null, authorization, repository
    );

    var created = sut.createConversation("noteId", "test", authInfo, userAndRoles);
    assertTrue(new File(tempDir, "noteId" + "/" + created.getId() + ".json").isFile());
  }

  @Test
  void rejectsMissingNote() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1)).process(null));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var repository = mock(ConversationRepository.class);
    var sut = new AssistantService(
        true, notebook, null, null, authorization, repository
    );

    assertThrows(
        NoteNotFoundException.class,
        () -> sut.createConversation("noteId", "test", authInfo, userAndRoles)
    );
    verifyNoInteractions(repository);
  }

  @Test
  void rejectsMissingConversation() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var repository = mock(ConversationRepository.class);
    when(repository.find("noteId", "missing")).thenReturn(Optional.empty());
    var sut = new AssistantService(true, notebook, null, null, authorization, repository);

    assertThrows(NotFoundException.class,
        () -> sut.getConversation("noteId", "missing", userAndRoles));
    assertThrows(NotFoundException.class,
        () -> sut.listMessages("noteId", "missing", null, 10, userAndRoles));
    assertThrows(NotFoundException.class,
        () -> sut.updateTitle("noteId", "missing", "title", authInfo.getUser(), userAndRoles));
    assertThrows(NotFoundException.class,
        () -> sut.deleteConversation("noteId", "missing", authInfo.getUser(), userAndRoles));

    var events = new ArrayList<AssistantEventPayload>();
    sut.sendMessage("noteId", "missing", "hi", authInfo, userAndRoles,
        (type, payload) -> events.add(payload));
    assertEquals(1, events.size());
    assertEquals(404, ((AssistantEventPayload.RunFailed) events.get(0)).error.status);
    verify(repository, never()).update(any(), any());
    verify(repository, never()).delete(anyString(), anyString());
  }

  @Test
  void releasesSlotAfterFailure() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);

    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    var repository = mock(ConversationRepository.class);
    when(repository.find("noteId", conversation.getId()))
        .thenReturn(Optional.of(conversation));
    var sut = new AssistantService(
        true, notebook, null, null, authorization, repository
    );

    doThrow(new IOException()).when(repository).update(any(), any());
    assertThrows(
        IOException.class,
        () -> sut.updateTitle("noteId", conversation.getId(), "discarded", authInfo.getUser(), userAndRoles)
    );

    doAnswer(invocation -> {
      invocation.<Consumer<Conversation>>getArgument(1).accept(invocation.getArgument(0));
      return null;
    }).when(repository).update(any(), any());
    var updated = sut.updateTitle(
        "noteId", conversation.getId(), "after-failure", authInfo.getUser(), userAndRoles
    );
    assertEquals("after-failure", updated.getTitle());
  }

  @Test
  void enforcesOwnership() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1))
            .process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);

    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    var repository = mock(ConversationRepository.class);
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    when(repository.findAll("noteId")).thenReturn(List.of(conversation));
    var sut = new AssistantService(
        true, notebook, null, null, authorization, repository
    );

    // A different reader can read.
    assertEquals(1, sut.listConversations("noteId", userAndRoles).size());
    assertNotNull(sut.getConversation("noteId", conversation.getId(), userAndRoles));
    assertNotNull(sut.listMessages("noteId", conversation.getId(), null, 10, userAndRoles));

    // But cannot mutate.
    assertThrows(ForbiddenException.class,
        () -> sut.deleteConversation("noteId", conversation.getId(), otherAuthInfo.getUser(), userAndRoles)
    );
    assertThrows(ForbiddenException.class,
        () -> sut.updateTitle("noteId", conversation.getId(), "x", otherAuthInfo.getUser(), userAndRoles));
    var events = new ArrayList<AssistantEventPayload>();
    sut.sendMessage("noteId", conversation.getId(), "hi", otherAuthInfo, userAndRoles,
        (type, payload) -> events.add(payload)
    );
    assertEquals(1, events.size());
    assertEquals(403, ((AssistantEventPayload.RunFailed) events.get(0)).error.status);
  }

  @Test
  void paginatesMessages() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1))
            .process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    var repository = mock(ConversationRepository.class);
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    var sut = new AssistantService(
        true, notebook, null, null, authorization, repository
    );

    var messages = List.of(
        Message.user("m1", "first"),
        Message.user("m2", "second"),
        Message.user("m3", "third"));
    messages.forEach(conversation::addMessage);

    var first = sut.listMessages("noteId", conversation.getId(), null, 2, userAndRoles);
    assertEquals(List.of(messages.get(2), messages.get(1)), first.messages);
    assertEquals("m2", first.cursor);

    var last = sut.listMessages("noteId", conversation.getId(), first.cursor, 2, userAndRoles);
    assertEquals(List.of(messages.get(0)), last.messages);
    assertNull(last.cursor);
  }

  @Test
  void rejectsInvalidLimit() {
    var sut = new AssistantService(
        true, null, null, null, null, null);
    assertThrows(
        BadRequestException.class,
        () -> sut.listMessages("noteId", "conv", null, 0, userAndRoles)
    );
    assertThrows(
        BadRequestException.class,
        () -> sut.listMessages("noteId", "conv", null, -1, userAndRoles)
    );
  }

  @Test
  void limitsModelHistory() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any())).thenAnswer(invocation ->
        ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var chatModel = mock(ChatModel.class);
    var repository = mock(ConversationRepository.class);
    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    var sut = new AssistantService(
        true, notebook, chatModel, null, authorization, repository
    );
    var limit = 10;

    for (int i = 0; i < limit + 2; i++) conversation.addMessage(Message.user("msg_" + i, "m" + i));
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    doAnswer(invocation -> {
      invocation.<Consumer<Conversation>>getArgument(1).accept(invocation.getArgument(0));
      return null;
    }).when(repository).update(any(), any());
    doAnswer(invocation -> {
      List<Message> history = invocation.getArgument(1);
      assertEquals(limit, history.size());
      assertEquals("m3", ((Message.User) history.get(0)).getContent());
      assertEquals("hi", ((Message.User) history.get(9)).getContent());
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    sut.sendMessage("noteId", conversation.getId(), "hi", authInfo, userAndRoles,
        (type, payload) -> { }
    );
  }

  @Test
  void streamsReply() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any())).thenAnswer(invocation ->
        ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var repository = mock(ConversationRepository.class);
    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    doAnswer(invocation -> {
      invocation.<Consumer<Conversation>>getArgument(1).accept(invocation.getArgument(0));
      return null;
    }).when(repository).update(any(), any());
    var chatModel = mock(ChatModel.class);
    var sut = new AssistantService(
        true, notebook, chatModel, null, authorization, repository
    );

    doAnswer(invocation -> {
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      consumer.accept(new AssistantEvent.TextDelta("Hel"));
      consumer.accept(new AssistantEvent.TextDelta("lo"));
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    var deltas = new ArrayList<String>();
    var dones = new ArrayList<String>();
    sut.sendMessage("noteId", conversation.getId(), "hi", authInfo, userAndRoles,
        (type, payload) -> {
          if (type == AssistantEventType.MESSAGE_DELTA) {
            deltas.add(((AssistantEventPayload.MessageDelta) payload).delta);
          } else if (type == AssistantEventType.MESSAGE_DONE) {
            dones.add(((AssistantEventPayload.MessageDone) payload).content);
          }
        });

    assertEquals(List.of("Hel", "lo"), deltas);
    assertEquals(List.of("Hello"), dones);
    assertEquals("Hello", ((Message.Assistant) conversation.getMessages().get(1)).getContent());
  }

  @Test
  void completesToolTurn() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1))
            .process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var repository = mock(ConversationRepository.class);

    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    doAnswer(invocation -> {
      invocation.<Consumer<Conversation>>getArgument(1).accept(invocation.getArgument(0));
      return null;
    }).when(repository).update(any(), any());
    var chatModel = mock(ChatModel.class);
    var notebookService = mock(NotebookService.class);
    var sut = new AssistantService(
        true, notebook, chatModel, notebookService, authorization, repository
    );

    doAnswer(invocation -> {
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      consumer.accept(new AssistantEvent.ToolCall("call_1", "list_paragraphs", "{}"));
      return null;
    }).doAnswer(invocation -> {
      List<Message> history = invocation.getArgument(1);
      assertEquals("call_1", ((Message.Tool) history.get(2)).getToolCallId());
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      consumer.accept(new AssistantEvent.TextDelta("final"));
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    sut.sendMessage("noteId", conversation.getId(), "hi", authInfo, userAndRoles,
        (type, payload) -> { }
    );

    var stored = conversation.getMessages();
    assertEquals(4, stored.size());

    Message.Assistant toolTurn = (Message.Assistant) stored.get(1);
    assertEquals("list_paragraphs", toolTurn.getToolCalls().get(0).getName());
    assertEquals("call_1", ((Message.Tool) stored.get(2)).getToolCallId());
    assertEquals("final", ((Message.Assistant) stored.get(3)).getContent());
  }

  @Test
  void guardsRunningConversation() throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any())).thenAnswer(invocation ->
        ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);
    var repository = mock(ConversationRepository.class);
    var conversation = Conversation.create("noteId", "test", authInfo.getUser());
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    doAnswer(invocation -> {
      invocation.<Consumer<Conversation>>getArgument(1).accept(invocation.getArgument(0));
      return null;
    }).when(repository).update(any(), any());
    var chatModel = mock(ChatModel.class);
    var sut = new AssistantService(
        true, notebook, chatModel, null, authorization, repository);

    var streaming = new CountDownLatch(1);
    var finish = new CountDownLatch(1);
    var executor = Executors.newSingleThreadExecutor();

    doAnswer(invocation -> {
      streaming.countDown(); // signal streaming has started
      assertTrue(finish.await(5, TimeUnit.SECONDS)); // wait for finish
      return null;
    }).when(chatModel).stream(any(), any(), any(), any());

    try {
      var running = executor.submit(() -> sut.sendMessage(
          "noteId", conversation.getId(), "hi", authInfo, userAndRoles,
          (type, payload) -> { })
      );
      assertTrue(streaming.await(5, TimeUnit.SECONDS));

      // other conversations can be mutated.
      var second = Conversation.create("noteId", "independent", authInfo.getUser());
      when(repository.find("noteId", second.getId())).thenReturn(Optional.of(second));
      assertEquals("updated",
          sut.updateTitle("noteId", second.getId(), "updated", authInfo.getUser(), userAndRoles)
              .getTitle()
      );

      // running conversation cannot be mutated.
      assertThrows(ClientErrorException.class,
          () -> sut.updateTitle("noteId", conversation.getId(), "renamed", authInfo.getUser(),
              userAndRoles)
      );
      assertThrows(ClientErrorException.class,
          () -> sut.deleteConversation("noteId", conversation.getId(), authInfo.getUser(),
              userAndRoles)
      );

      var events = new ArrayList<AssistantEventPayload>();
      sut.sendMessage("noteId", conversation.getId(), "duplicated", authInfo, userAndRoles,
          (type, payload) -> events.add(payload)
      );
      assertEquals(409, ((AssistantEventPayload.RunFailed) events.get(0)).error.status);

      finish.countDown();
      running.get(5, TimeUnit.SECONDS); //  wait for message processing to complete.

      assertEquals("released",
          sut.updateTitle("noteId", conversation.getId(), "released", authInfo.getUser(), userAndRoles)
              .getTitle()
      );
    } finally {
      finish.countDown();
      executor.shutdownNow();
    }
  }
}
