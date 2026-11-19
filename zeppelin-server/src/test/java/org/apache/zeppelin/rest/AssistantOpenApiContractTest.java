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

package org.apache.zeppelin.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.annotation.JsonAutoDetect.Visibility;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.core.jackson.ModelResolver;
import io.swagger.v3.core.util.Json31;
import io.swagger.v3.core.util.Configuration;
import io.swagger.v3.oas.integration.SwaggerConfiguration;
import io.swagger.v3.jaxrs2.Reader;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.Response;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import org.apache.zeppelin.service.AuthenticationService;
import org.apache.zeppelin.service.assistant.Assistant;
import org.apache.zeppelin.service.assistant.Conversation;
import org.apache.zeppelin.service.assistant.Message;
import org.apache.zeppelin.service.assistant.MessagePage;
import org.apache.zeppelin.service.assistant.ToolCall;
import org.apache.zeppelin.service.assistant.ToolResult;
import org.junit.jupiter.api.Test;

/** Emits the code-first REST description and actual resource status/entity pairs. */
class AssistantOpenApiContractTest {
  @Test
  void generatesDescriptionAndResourceResponses() throws Exception {
    // Schema introspection mirrors Gson's fields, not Jackson bean getters. Runtime is untouched.
    var mapper = Json31.mapper().copy()
        .setVisibility(PropertyAccessor.ALL, Visibility.NONE)
        .setVisibility(PropertyAccessor.FIELD, Visibility.ANY)
        .enable(MapperFeature.PROPAGATE_TRANSIENT_MARKER)
        .disable(SerializationFeature.WRITE_ENUMS_USING_TO_STRING);
    var converters = ModelConverters.getInstance(true);
    var resolver = new ModelResolver(mapper);
    resolver.setConfiguration(new Configuration().openAPI31(true));
    converters.addConverter(resolver);
    OpenAPI document;
    try {
      document = new Reader(new SwaggerConfiguration().openAPI31(true).openAPI(
          new OpenAPI().openapi("3.1.0").info(new Info()
              .title("Zeppelin Assistant REST API").version("1"))))
          .read(Set.of(AssistantConversationRestApi.class, AssistantMessageRestApi.class));
    } finally {
      converters.removeConverter(resolver);
    }
    assertEquals(6, document.getPaths().values().stream()
        .mapToInt(path -> path.readOperations().size()).sum());

    var authentication = mock(AuthenticationService.class);
    when(authentication.getPrincipal()).thenReturn("owner");
    when(authentication.getAssociatedRoles()).thenReturn(Set.of());
    var assistant = mock(Assistant.class);
    var conversation = Conversation.create("note", null, "owner");
    var toolOnly = Message.assistant("tool-answer", null);
    toolOnly.addToolCall(new ToolCall("call", "get_note", null));
    toolOnly.getToolCalls().get(0).setResult(new ToolResult(java.util.Map.of("ok", true), null));
    var messages = List.<Message>of(Message.user("question", "Question"), toolOnly,
        Message.tool("tool", "call", "Result"), Message.assistant("answer", "Answer"));
    messages.forEach(conversation::addMessage);
    when(assistant.listConversations(eq("note"), any())).thenReturn(List.of(conversation));
    when(assistant.createConversation(eq("note"), any(), any(), any())).thenReturn(conversation);
    when(assistant.getConversation(eq("note"), anyString(), any())).thenReturn(conversation);
    when(assistant.updateTitle(eq("note"), anyString(), anyString(), eq("owner"), any()))
        .thenReturn(conversation);
    when(assistant.listMessages(eq("note"), anyString(), any(), eq(10), any()))
        .thenReturn(new MessagePage(messages, null));
    var conversations = new AssistantConversationRestApi(authentication, assistant);
    var history = new AssistantMessageRestApi(authentication, assistant);
    var exchanges = new JsonArray();
    exchanges.add(exchange("listAssistantConversations", conversations.list("note")));
    exchanges.add(exchange("createAssistantConversation", conversations.create("note", "{}")));
    exchanges.add(exchange("getAssistantConversation", conversations.get("note", "conversation")));
    exchanges.add(exchange("renameAssistantConversation",
        conversations.updateTitle("note", "conversation", "{\"title\":\"Renamed\"}")));
    exchanges.add(exchange("deleteAssistantConversation",
        conversations.delete("note", "conversation")));
    exchanges.add(exchange("listAssistantMessages",
        history.list("note", "conversation", null, 10)));
    assertThrows(BadRequestException.class,
        () -> conversations.updateTitle("note", "conversation", "{\"title\":\" \"}"));
    Path output = Path.of(System.getProperty("assistant.openapi.output",
        "target/assistant-contract/openapi.json"));
    Files.createDirectories(output.toAbsolutePath().getParent());
    Files.writeString(output, Json31.pretty(document));
    Files.writeString(output.resolveSibling("rest-exchanges.json"), exchanges.toString());
  }

  private JsonObject exchange(String operationId, Response response) {
    var exchange = new JsonObject();
    exchange.addProperty("operationId", operationId);
    exchange.addProperty("status", response.getStatus());
    if (response.hasEntity()) {
      exchange.add("body", JsonParser.parseString(response.getEntity().toString()));
    }
    return exchange;
  }
}
