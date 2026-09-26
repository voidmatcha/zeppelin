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
import com.google.gson.GsonBuilder;
import com.google.gson.JsonDeserializationContext;
import com.google.gson.JsonDeserializer;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonSerializationContext;
import com.google.gson.JsonSerializer;

import java.lang.reflect.Type;
import java.util.List;

/**
 * JSON wire format for the inline hidden-paragraph storage of assistant conversations.
 */
final class ConversationJsonCodec {

  private static final Gson GSON = new GsonBuilder()
      .registerTypeAdapter(Message.class, new MessageAdapter())
      .create();

  private ConversationJsonCodec() {
  }

  static String serialize(List<Conversation> conversations) {
    return GSON.toJson(new Data(conversations));
  }

  static List<Conversation> deserialize(String json) {
    Data data = GSON.fromJson(json, Data.class);
    if (data == null || data.conversations == null
        || data.conversations.stream().anyMatch(c -> c == null || c.getId() == null
        || c.getMessages() == null)) {
      throw new JsonParseException("Invalid assistant conversation storage");
    }
    return data.conversations;
  }

  /**
   * JSON root wrapper.
   */
  private static class Data {
    List<Conversation> conversations;

    Data(List<Conversation> conversations) {
      this.conversations = conversations;
    }
  }

  /**
   * Routes deserialization to the concrete Message subtype based on {@code role}.
   */
  private static class MessageAdapter
      implements JsonDeserializer<Message>, JsonSerializer<Message> {
    private static final Gson SUBTYPE = new Gson();

    @Override
    public Message deserialize(JsonElement json, Type type, JsonDeserializationContext ctx)
        throws JsonParseException {
      JsonObject obj = json.getAsJsonObject();
      if (!obj.has("role")) {
        throw new JsonParseException("Message missing 'role' field");
      }
      Message.Role role = Message.Role.fromValue(obj.get("role").getAsString());
      switch (role) {
        case USER:
          return SUBTYPE.fromJson(json, Message.User.class);
        case ASSISTANT:
          return SUBTYPE.fromJson(json, Message.Assistant.class);
        case TOOL:
          return SUBTYPE.fromJson(json, Message.Tool.class);
        default:
          throw new JsonParseException("Unsupported role: " + role);
      }
    }

    @Override
    public JsonElement serialize(Message src, Type type, JsonSerializationContext ctx) {
      return SUBTYPE.toJsonTree(src);
    }
  }
}
