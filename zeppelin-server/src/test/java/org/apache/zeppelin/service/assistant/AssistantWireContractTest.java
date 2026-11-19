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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response.Status;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Notebook.NoteProcessor;
import org.apache.zeppelin.rest.message.ConversationMetadata;
import org.apache.zeppelin.rest.message.MessagesResponse;
import org.apache.zeppelin.server.JsonResponse;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.socket.NotebookServer;
import org.apache.zeppelin.socket.NotebookSocket;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

/** Generates consumer inputs through the production REST and WebSocket serializers. */
class AssistantWireContractTest {
  @Test
  void writesProviderFixtures(@TempDir File directory) throws Exception {
    var conversation = Conversation.create("note", null, "owner");
    var owner = ConversationMetadata.of(conversation, "owner");
    var reader = ConversationMetadata.of(conversation, "reader");
    var fixtures = new JsonObject();
    fixtures.add("conversations", rest(List.of(owner, reader)));
    fixtures.add("createdConversation", rest(owner));

    // Storage accepts omitted or null display metadata; exercise that actual read path too.
    var stored = JsonParser.parseString(ConversationJsonCodec.serialize(conversation))
        .getAsJsonObject();
    var sparseConversations = new JsonArray();
    for (boolean explicitNull : List.of(false, true)) {
      for (String field : List.of("title", "updatedAt")) {
        if (explicitNull) {
          stored.add(field, null);
        } else {
          stored.remove(field);
        }
      }
      var loaded = ConversationJsonCodec.deserialize(stored.toString());
      var metadata = rest(ConversationMetadata.of(loaded, "owner"));
      assertFalse(metadata.getAsJsonObject().getAsJsonObject("body").has("title"));
      assertFalse(metadata.getAsJsonObject().getAsJsonObject("body").has("updatedAt"));
      sparseConversations.add(metadata);
    }
    fixtures.add("sparseConversations", sparseConversations);

    var toolOnly = Message.assistant("tool-answer", null);
    toolOnly.addToolCall(new ToolCall("call", "get_note", Map.of("noteId", "note")));
    var history = rest(MessagesResponse.of(new MessagePage(List.of(
        Message.assistant("answer", "Answer"), Message.tool("result", "call", "Result"),
        toolOnly, Message.user("question", "Question")), null)));
    assertFalse(history.getAsJsonObject().getAsJsonObject("body").has("cursor"));
    assertFalse(history.getAsJsonObject().getAsJsonObject("body")
        .getAsJsonArray("messages").get(2).getAsJsonObject().has("content"));
    fixtures.add("history", history);
    // Older storage may omit message timestamps and tool arguments. Preserve compatibility.
    var sparseMessages = history.getAsJsonObject().getAsJsonObject("body")
        .getAsJsonArray("messages").deepCopy();
    for (var message : sparseMessages) {
      message.getAsJsonObject().remove("createdAt");
    }
    sparseMessages.get(2).getAsJsonObject().getAsJsonArray("toolCalls")
        .get(0).getAsJsonObject().remove("arguments");
    stored.add("messages", sparseMessages);
    var sparseLoaded = ConversationJsonCodec.deserialize(stored.toString());
    fixtures.add("sparseHistory", rest(MessagesResponse.of(
        new MessagePage(sparseLoaded.getMessages(), null))));
    fixtures.add("olderHistory", rest(MessagesResponse.of(new MessagePage(List.of(), "cursor"))));

    var events = new JsonArray();
    events.add(event(AssistantEventType.RUN_STARTED,
        new AssistantEventPayload.RunStarted("run", "2026-01-01T00:00:00Z")));
    events.add(event(AssistantEventType.MESSAGE_DELTA,
        new AssistantEventPayload.MessageDelta("answer", "Answer")));
    events.add(event(AssistantEventType.MESSAGE_DONE,
        new AssistantEventPayload.MessageDone("answer", "Answer")));
    events.add(event(AssistantEventType.TOOL_CALL_STARTED,
        new AssistantEventPayload.ToolCallStarted("call", "get_note", Map.of())));
    events.add(event(AssistantEventType.TOOL_CALL_DONE,
        new AssistantEventPayload.ToolCallDone("call", new ToolResult("Result", null))));
    events.add(event(AssistantEventType.RUN_COMPLETED,
        new AssistantEventPayload.RunCompleted("run", new AssistantEventPayload.Usage(1, 2))));
    events.add(event(AssistantEventType.RUN_FAILED, new AssistantEventPayload.RunFailed("run",
        AssistantEventPayload.Error.of(new WebApplicationException(409)))));
    assertEquals(Arrays.stream(AssistantEventType.values()).map(type -> type.wireName)
        .collect(Collectors.toSet()),
        StreamSupport.stream(events.spliterator(), false)
            .map(value -> value.getAsJsonObject().getAsJsonObject("data")
            .get("type").getAsString()).collect(Collectors.toSet()),
        "Add a provider fixture and consumer expectation for each new event type");
    fixtures.add("events", events);
    fixtures.add("produced", produced(directory));

    Path output = Path.of(System.getProperty("assistant.contract.output",
        "target/assistant-contract/wire.json"));
    Files.createDirectories(output.toAbsolutePath().getParent());
    Files.writeString(output, new GsonBuilder().setPrettyPrinting().create().toJson(fixtures));
  }

  private JsonObject produced(File directory) throws Exception {
    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("note"), any())).thenAnswer(invocation ->
        ((NoteProcessor<?>) invocation.getArgument(1)).process(new Note()));
    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("note", Set.of("owner"))).thenReturn(true);
    var model = mock(ChatModel.class);
    doAnswer(invocation -> {
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      consumer.accept(new AssistantEvent.ToolCall("produced-call", "list_paragraphs", "{}"));
      return null;
    }).doAnswer(invocation -> {
      Consumer<AssistantEvent> consumer = invocation.getArgument(3);
      consumer.accept(new AssistantEvent.TextDelta("Produced answer"));
      return null;
    }).when(model).stream(any(), any(), any(), any());
    var repository = new FileConversationRepository(directory);
    var executor = Executors.newSingleThreadExecutor();
    try {
      var assistant = new AssistantImpl(notebook, model, mock(NotebookService.class),
          authorization, repository, executor);
      var auth = new AuthenticationInfo("owner");
      var conversation = assistant.createConversation("note", null, auth, Set.of("owner"));
      var events = new JsonArray();
      AssistantEventListener sink = (type, payload) -> {
        try {
          events.add(event(type, payload));
        } catch (Exception exception) {
          throw new AssertionError(exception);
        }
      };
      assistant.sendMessage("note", conversation.getId(), "Produced question", auth,
          Set.of("owner"), sink).get(5, TimeUnit.SECONDS);
      assistant.sendMessage("note", conversation.getId(), " ", auth,
          Set.of("owner"), sink).get(5, TimeUnit.SECONDS);
      var result = new JsonObject();
      result.add("events", events);
      result.add("history", rest(MessagesResponse.of(assistant.listMessages(
          "note", conversation.getId(), null, 50, Set.of("owner")))));
      return result;
    } finally {
      executor.shutdownNow();
    }
  }

  private JsonElement rest(Object body) {
    return JsonParser.parseString(new JsonResponse<>(Status.OK, "", body).toString());
  }

  private JsonElement event(AssistantEventType type, AssistantEventPayload payload)
      throws Exception {
    var assistant = mock(Assistant.class);
    var server = mock(NotebookServer.class, CALLS_REAL_METHODS);
    doReturn(assistant).when(server).getAssistant();
    doAnswer(invocation -> {
      AssistantEventListener sink = invocation.getArgument(5);
      sink.onEvent(type, payload);
      return null;
    }).when(assistant).sendMessage(anyString(), anyString(), anyString(), any(), any(), any());
    var socket = mock(NotebookSocket.class);
    var request = new org.apache.zeppelin.common.Message(OP.ASSISTANT_SEND_MESSAGE)
        .put("noteId", "note").put("conversationId", "conversation").put("content", "Question");
    // Enter the production handler so envelope names and routing cannot drift from the fixture.
    var send = NotebookServer.class.getDeclaredMethod("sendAssistantMessage", NotebookSocket.class,
        ServiceContext.class, org.apache.zeppelin.common.Message.class);
    send.setAccessible(true);
    send.invoke(server, socket,
        new ServiceContext(AuthenticationInfo.ANONYMOUS, Set.of("anonymous")), request);
    var wire = ArgumentCaptor.forClass(String.class);
    verify(socket).send(wire.capture());
    return JsonParser.parseString(wire.getValue());
  }
}
