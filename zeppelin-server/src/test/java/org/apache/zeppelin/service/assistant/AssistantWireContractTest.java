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
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response.Status;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.rest.message.ConversationMetadata;
import org.apache.zeppelin.rest.message.MessagesResponse;
import org.apache.zeppelin.server.JsonResponse;
import org.apache.zeppelin.socket.NotebookServer;
import org.junit.jupiter.api.Test;

/** Generates consumer inputs through the production REST and WebSocket serializers. */
class AssistantWireContractTest {
  @Test
  void writesProviderFixtures() throws Exception {
    var conversation = Conversation.create("note", null, "owner");
    var owner = ConversationMetadata.of(conversation, "owner");
    var reader = ConversationMetadata.of(conversation, "reader");
    var fixtures = new JsonObject();
    fixtures.add("conversations", rest(List.of(owner, reader)));
    fixtures.add("createdConversation", rest(owner));

    var toolOnly = Message.assistant("tool-answer", null);
    toolOnly.addToolCall(new ToolCall("call", "get_note", Map.of("noteId", "note")));
    var history = rest(MessagesResponse.of(new MessagePage(List.of(
        Message.assistant("answer", "Answer"), Message.tool("result", "call", "Result"),
        toolOnly, Message.user("question", "Question")), null)));
    assertFalse(history.getAsJsonObject().getAsJsonObject("body").has("cursor"));
    assertFalse(history.getAsJsonObject().getAsJsonObject("body")
        .getAsJsonArray("messages").get(2).getAsJsonObject().has("content"));
    fixtures.add("history", history);
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
    assertEquals(AssistantEventType.values().length, events.size(),
        "Add a provider fixture and consumer expectation for each new event type");
    fixtures.add("events", events);

    Path output = Path.of(System.getProperty("assistant.contract.output",
        "target/assistant-contract/wire.json"));
    Files.createDirectories(output.toAbsolutePath().getParent());
    Files.writeString(output, new GsonBuilder().setPrettyPrinting().create().toJson(fixtures));
  }

  private JsonElement rest(Object body) {
    return JsonParser.parseString(new JsonResponse<>(Status.OK, "", body).toString());
  }

  private JsonElement event(AssistantEventType type, AssistantEventPayload payload)
      throws Exception {
    var message = new org.apache.zeppelin.common.Message(OP.ASSISTANT_EVENT)
        .put("conversationId", "conversation").put("type", type.wireName).put("payload", payload);
    // Invoke the actual protected serializer without starting Jetty or an interpreter.
    var serialize = NotebookServer.class.getDeclaredMethod("serializeMessage",
        org.apache.zeppelin.common.Message.class);
    serialize.setAccessible(true);
    var server = mock(NotebookServer.class, CALLS_REAL_METHODS);
    return JsonParser.parseString((String) serialize.invoke(server, message));
  }
}
