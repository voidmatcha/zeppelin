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

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import org.jvnet.hk2.annotations.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
public class OpenAiClient {

  private static final Logger LOGGER = LoggerFactory.getLogger(OpenAiClient.class);
  private static final Gson GSON = new Gson();
  private static final String OPENAI_URL = "https://api.openai.com/v1/chat/completions";

  private final HttpClient httpClient = HttpClient.newHttpClient();

  public static class OpenAiEvent {
    public enum Type { TEXT_DELTA, TOOL_CALL_DELTA, FINISH, ERROR }

    public final Type type;
    public final String messageId;
    public final String delta;
    public final String finishReason;
    // tool call
    public final int toolCallIndex;
    public final String toolCallId;
    public final String toolName;
    public final String toolArgsDelta;
    // usage (on finish)
    public final Integer inputTokens;
    public final Integer outputTokens;

    private OpenAiEvent(Builder b) {
      this.type = b.type;
      this.messageId = b.messageId;
      this.delta = b.delta;
      this.finishReason = b.finishReason;
      this.toolCallIndex = b.toolCallIndex;
      this.toolCallId = b.toolCallId;
      this.toolName = b.toolName;
      this.toolArgsDelta = b.toolArgsDelta;
      this.inputTokens = b.inputTokens;
      this.outputTokens = b.outputTokens;
    }

    static class Builder {
      Type type;
      String messageId, delta, finishReason, toolCallId, toolName, toolArgsDelta;
      int toolCallIndex = -1;
      Integer inputTokens, outputTokens;
      Builder type(Type t) { this.type = t; return this; }
      Builder messageId(String v) { this.messageId = v; return this; }
      Builder delta(String v) { this.delta = v; return this; }
      Builder finishReason(String v) { this.finishReason = v; return this; }
      Builder toolCallIndex(int v) { this.toolCallIndex = v; return this; }
      Builder toolCallId(String v) { this.toolCallId = v; return this; }
      Builder toolName(String v) { this.toolName = v; return this; }
      Builder toolArgsDelta(String v) { this.toolArgsDelta = v; return this; }
      Builder usage(int in, int out) { this.inputTokens = in; this.outputTokens = out; return this; }
      OpenAiEvent build() { return new OpenAiEvent(this); }
    }
  }

  public void streamChatCompletions(
      String apiKey,
      String model,
      List<Map<String, Object>> messages,
      List<Map<String, Object>> tools,
      Consumer<OpenAiEvent> consumer) {

    Map<String, Object> body = new HashMap<>();
    body.put("model", model);
    body.put("messages", messages);
    body.put("stream", true);
    body.put("stream_options", Map.of("include_usage", true));
    if (tools != null && !tools.isEmpty()) {
      body.put("tools", tools);
    }

    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(OPENAI_URL))
        .header("Content-Type", "application/json")
        .header("Authorization", "Bearer " + apiKey)
        .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body)))
        .build();

    HttpResponse<java.util.stream.Stream<String>> response;
    try {
      response = httpClient.send(request, HttpResponse.BodyHandlers.ofLines());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new UncheckedIOException(new IOException("OpenAI request interrupted", e));
    }

    try (java.util.stream.Stream<String> lines = response.body()) {
      if (response.statusCode() != 200) {
        throw new IOException("OpenAI API error " + response.statusCode());
      }
      lines.forEach(line -> {
        if (!line.startsWith("data: ")) {
          return;
        }
        String data = line.substring(6).trim();
        if (!"[DONE]".equals(data)) {
          JsonObject chunk = GSON.fromJson(data, JsonObject.class);
          if (chunk.has("error")) {
            throw new IllegalStateException("OpenAI stream failed");
          }
          parseSseChunk(chunk, consumer);
        }
      });
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private void parseSseChunk(JsonObject chunk, Consumer<OpenAiEvent> consumer) {
    String messageId = chunk.has("id") ? chunk.get("id").getAsString() : null;

    // usage (included in the final chunk)
    if (chunk.has("usage") && !chunk.get("usage").isJsonNull()) {
      JsonObject usage = chunk.getAsJsonObject("usage");
      int inputTokens = usage.has("prompt_tokens") ? usage.get("prompt_tokens").getAsInt() : 0;
      int outputTokens = usage.has("completion_tokens") ? usage.get("completion_tokens").getAsInt() : 0;
      consumer.accept(new OpenAiEvent.Builder()
          .type(OpenAiEvent.Type.FINISH)
          .messageId(messageId)
          .usage(inputTokens, outputTokens)
          .build());
      return;
    }

    JsonArray choices = chunk.getAsJsonArray("choices");
    if (choices == null || choices.isEmpty()) return;

    JsonObject choice = choices.get(0).getAsJsonObject();
    String finishReason = choice.has("finish_reason") && !choice.get("finish_reason").isJsonNull()
        ? choice.get("finish_reason").getAsString() : null;

    if (finishReason != null && !finishReason.isEmpty()) {
      consumer.accept(new OpenAiEvent.Builder()
          .type(OpenAiEvent.Type.FINISH)
          .messageId(messageId)
          .finishReason(finishReason)
          .build());
      return;
    }

    JsonObject delta = choice.getAsJsonObject("delta");
    if (delta == null) return;

    // text delta
    if (delta.has("content") && !delta.get("content").isJsonNull()) {
      String text = delta.get("content").getAsString();
      if (!text.isEmpty()) {
        consumer.accept(new OpenAiEvent.Builder()
            .type(OpenAiEvent.Type.TEXT_DELTA)
            .messageId(messageId)
            .delta(text)
            .build());
      }
    }

    // tool_calls delta
    if (delta.has("tool_calls")) {
      JsonArray toolCalls = delta.getAsJsonArray("tool_calls");
      for (JsonElement el : toolCalls) {
        JsonObject tc = el.getAsJsonObject();
        int index = tc.has("index") ? tc.get("index").getAsInt() : 0;
        String tcId = tc.has("id") && !tc.get("id").isJsonNull() ? tc.get("id").getAsString() : null;
        String tcName = null;
        String tcArgsDelta = null;

        if (tc.has("function")) {
          JsonObject fn = tc.getAsJsonObject("function");
          if (fn.has("name") && !fn.get("name").isJsonNull()) {
            tcName = fn.get("name").getAsString();
          }
          if (fn.has("arguments") && !fn.get("arguments").isJsonNull()) {
            tcArgsDelta = fn.get("arguments").getAsString();
          }
        }

        consumer.accept(new OpenAiEvent.Builder()
            .type(OpenAiEvent.Type.TOOL_CALL_DELTA)
            .messageId(messageId)
            .toolCallIndex(index)
            .toolCallId(tcId)
            .toolName(tcName)
            .toolArgsDelta(tcArgsDelta)
            .build());
      }
    }
  }

  /** Convert a list of messages (including tool results) into OpenAI wire format. */
  public static List<Map<String, Object>> toOpenAiMessages(List<Message> messages) {
    List<Map<String, Object>> result = new ArrayList<>();
    for (Message m : messages) {
      result.add(toOpenAiMessage(m));
    }
    return result;
  }

  private static Map<String, Object> toOpenAiMessage(Message m) {
    Map<String, Object> msg = new HashMap<>();
    msg.put("role", m.getRole().name().toLowerCase());

    if (m instanceof Message.Tool) {
      Message.Tool t = (Message.Tool) m;
      msg.put("tool_call_id", t.getToolCallId());
      msg.put("content", t.getContent() != null ? t.getContent() : "");
    } else if (m instanceof Message.Assistant) {
      Message.Assistant a = (Message.Assistant) m;
      msg.put("content", a.getContent() != null ? a.getContent() : "");
      if (!a.getToolCalls().isEmpty()) {
        List<Map<String, Object>> tcList = new ArrayList<>();
        for (ToolCall tc : a.getToolCalls()) {
          tcList.add(Map.of(
              "id", tc.getId(),
              "type", "function",
              "function", Map.of(
                  "name", tc.getName(),
                  "arguments", GSON.toJson(tc.getArguments())
              )
          ));
        }
        msg.put("tool_calls", tcList);
      }
    } else if (m instanceof Message.User) {
      msg.put("content", ((Message.User) m).getContent());
    }
    return msg;
  }
}
