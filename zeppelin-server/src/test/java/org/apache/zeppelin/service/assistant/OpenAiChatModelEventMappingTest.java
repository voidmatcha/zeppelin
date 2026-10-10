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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class OpenAiChatModelEventMappingTest {
  private static final Gson GSON = new Gson();

  @Test
  void mapsTextRefusalToolCallAndCompletionUsageInOrder() throws Exception {
    var events = new ArrayList<AssistantEvent>();
    withStream(List.of(
        delta("response.output_text.delta", "Hello"),
        delta("response.refusal.delta", "I cannot help with that"),
        Map.of("type", "response.output_item.done", "output_index", 0,
            "sequence_number", 2, "item", Map.of("type", "function_call", "id", "item",
                "call_id", "call", "name", "listNotes", "arguments", "{\"limit\":2}",
                "status", "completed")),
        completed(Map.of("input_tokens", 12, "output_tokens", 7, "total_tokens", 19,
            "input_tokens_details", Map.of("cached_tokens", 0),
            "output_tokens_details", Map.of("reasoning_tokens", 0)))),
        model -> model.stream("instruction", List.of(), List.of(), events::add));

    assertEquals(4, events.size());
    assertEquals("Hello", ((AssistantEvent.TextDelta) events.get(0)).delta);
    assertEquals("I cannot help with that", ((AssistantEvent.TextDelta) events.get(1)).delta);
    var tool = (AssistantEvent.ToolCall) events.get(2);
    assertEquals("call", tool.id);
    assertEquals("listNotes", tool.name);
    assertEquals(Map.of("limit", 2.0), tool.arguments);
    var usage = (AssistantEvent.Usage) events.get(3);
    assertEquals(12, usage.inputTokens);
    assertEquals(7, usage.outputTokens);
  }

  @Test
  void errorEventFailsWithoutPublishingAReply() throws Exception {
    var events = new ArrayList<AssistantEvent>();
    withStream(List.of(Map.of("type", "error", "code", "server_error",
        "message", "upstream unavailable", "sequence_number", 0)), model -> {
          var error = assertThrows(IllegalStateException.class,
              () -> model.stream("instruction", List.of(), List.of(), events::add));
          assertEquals("OpenAI stream error: upstream unavailable", error.getMessage());
        });
    assertTrue(events.isEmpty());
  }

  @Test
  void failedAndIncompleteEventsFailInsteadOfCompleting() throws Exception {
    for (String status : List.of("failed", "incomplete")) {
      var events = new ArrayList<AssistantEvent>();
      withStream(List.of(Map.of("type", "response." + status, "sequence_number", 0,
          "response", Map.of("id", "response", "status", status))), model -> {
            var error = assertThrows(IllegalStateException.class,
                () -> model.stream("instruction", List.of(), List.of(), events::add));
            assertEquals("OpenAI response " + status, error.getMessage());
          });
      assertTrue(events.isEmpty());
    }
  }

  @Test
  void streamWithoutCompletionFailsAfterPartialText() throws Exception {
    var events = new ArrayList<AssistantEvent>();
    withStream(List.of(delta("response.output_text.delta", "partial")), model ->
        assertThrows(IllegalStateException.class,
            () -> model.stream("instruction", List.of(), List.of(), events::add)));
    assertEquals(1, events.size());
    assertEquals("partial", ((AssistantEvent.TextDelta) events.get(0)).delta);
  }

  @Test
  void completionWithoutUsageDoesNotInventUsage() throws Exception {
    var events = new ArrayList<AssistantEvent>();
    withStream(List.of(Map.of("type", "response.completed", "sequence_number", 0,
        "response", Map.of("id", "response", "status", "completed"))), model ->
        model.stream("instruction", List.of(), List.of(), events::add));
    assertTrue(events.isEmpty());
  }

  private static Map<String, Object> delta(String type, String text) {
    return Map.of("type", type, "delta", text, "item_id", "item", "content_index", 0,
        "output_index", 0, "sequence_number", 0, "logprobs", List.of());
  }

  private static Map<String, Object> completed(Map<String, Object> usage) {
    return Map.of("type", "response.completed", "sequence_number", 3,
        "response", Map.of("id", "response", "status", "completed", "usage", usage));
  }

  private static void withStream(List<Map<String, Object>> events,
      Consumer<OpenAiChatModel> check) throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var stream = new StringBuilder();
    for (var event : events) {
      stream.append("event: ").append(event.get("type"))
          .append("\ndata: ").append(GSON.toJson(event)).append("\n\n");
    }
    var bytes = stream.toString().getBytes(StandardCharsets.UTF_8);
    server.createContext("/responses", exchange -> {
      exchange.getRequestBody().readAllBytes();
      exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
      exchange.sendResponseHeaders(200, bytes.length);
      try (var body = exchange.getResponseBody()) {
        body.write(bytes);
      }
    });
    server.start();
    var model = new OpenAiChatModel("http://127.0.0.1:" + server.getAddress().getPort(),
        "test-key", "test-model");
    try {
      check.accept(model);
    } finally {
      model.close();
      server.stop(0);
    }
  }
}
