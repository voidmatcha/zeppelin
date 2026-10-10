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

import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FileConversationRepositoryTest {
  @Test
  void storesSeparateFiles(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);

    var first = Conversation.create("noteId", "first", "holden");
    sut.create(first);
    var second = Conversation.create("noteId", "second", "holden");
    sut.create(second);

    var loaded = sut.findAll("noteId");

    assertEquals(
        Set.of(first.getId(), second.getId()), loaded.stream().map(Conversation::getId)
        .collect(Collectors.toSet())
    );
    assertTrue(new File(directory, "noteId/" + first.getId() + ".json").isFile());
    assertTrue(new File(directory, "noteId/" + second.getId() + ".json").isFile());
  }

  @Test
  void propagatesReadFailure(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    Files.createDirectories(new File(directory, "noteId/unreadable.json").toPath());
    assertThrows(IOException.class, () -> sut.findAll("noteId"));
    assertThrows(IOException.class, () -> sut.find("noteId", "unreadable"));
  }

  @Test
  void skipsMalformedSiblingWithoutTreatingItAsMissing(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "valid", "holden");
    sut.create(conversation);
    Files.writeString(new File(directory, "noteId/corrupt.json").toPath(), "{incomplete");

    assertEquals(List.of(conversation.getId()), sut.findAll("noteId").stream()
        .map(Conversation::getId).collect(Collectors.toList()));
    assertThrows(JsonParseException.class, () -> sut.find("noteId", "corrupt"));
  }

  @Test
  void rejectsMissingOwnerAndInvalidCreationTime(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "valid", "holden");
    sut.create(conversation);

    for (String field : List.of("ownerId", "createdAt")) {
      var json = JsonParser.parseString(ConversationJsonCodec.serialize(conversation))
          .getAsJsonObject();
      json.remove(field);
      Files.writeString(new File(directory, "noteId/missing-" + field + ".json").toPath(),
          json.toString());
      assertThrows(JsonParseException.class, () -> sut.find("noteId", "missing-" + field));

      json.addProperty(field, "");
      Files.writeString(new File(directory, "noteId/invalid-" + field + ".json").toPath(),
          json.toString());
      assertThrows(JsonParseException.class, () -> sut.find("noteId", "invalid-" + field));
    }

    assertEquals(List.of(conversation.getId()), sut.findAll("noteId").stream()
        .map(Conversation::getId).collect(Collectors.toList()));
  }

  @Test
  void skipsSiblingWithInvalidMessageRole(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "valid", "holden");
    sut.create(conversation);
    conversation.addMessage(Message.user("msg", "content"));
    var json = JsonParser.parseString(ConversationJsonCodec.serialize(conversation))
        .getAsJsonObject();
    json.getAsJsonArray("messages").get(0).getAsJsonObject().addProperty("role", "unknown");
    Files.writeString(new File(directory, "noteId/invalid-role.json").toPath(), json.toString());

    assertEquals(List.of(conversation.getId()), sut.findAll("noteId").stream()
        .map(Conversation::getId).collect(Collectors.toList()));
    assertThrows(JsonParseException.class, () -> sut.find("noteId", "invalid-role"));
  }

  @Test
  void rejectsNullAndIncompleteMessages(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var valid = Conversation.create("noteId", "valid", "holden");
    valid.addMessage(Message.user("user", "hello"));
    valid.addMessage(Message.assistant("assistant", ""));
    valid.addMessage(Message.tool("tool", "call", ""));
    sut.create(valid);

    var invalidMessages = List.of("null", "{}",
        "{\"role\":\"user\",\"content\":\"hello\"}",
        "{\"role\":\"user\",\"id\":\" \",\"content\":\"hello\"}",
        "{\"role\":\"user\",\"id\":1,\"content\":\"hello\"}",
        "{\"role\":\"user\",\"id\":\"user\"}",
        "{\"role\":\"assistant\",\"id\":\"assistant\",\"content\":null}",
        "{\"role\":\"assistant\",\"id\":\"assistant\",\"content\":1}",
        "{\"role\":\"tool\",\"id\":\"tool\",\"content\":\"result\"}");
    for (int i = 0; i < invalidMessages.size(); i++) {
      var json = JsonParser.parseString(ConversationJsonCodec.serialize(valid)).getAsJsonObject();
      json.getAsJsonArray("messages").set(0, JsonParser.parseString(invalidMessages.get(i)));
      String id = "invalid-message-" + i;
      Files.writeString(new File(directory, "noteId/" + id + ".json").toPath(), json.toString());
      assertThrows(JsonParseException.class, () -> sut.find("noteId", id), id);
    }

    assertEquals(List.of(valid.getId()), sut.findAll("noteId").stream()
        .map(Conversation::getId).collect(Collectors.toList()));
    var loaded = sut.find("noteId", valid.getId()).orElseThrow();
    assertEquals("", ((Message.Assistant) loaded.getMessages().get(1)).getContent());
    assertEquals("", ((Message.Tool) loaded.getMessages().get(2)).getContent());
  }

  @Test
  void rejectsDuplicate(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "title", "holden");
    sut.create(conversation);

    conversation.setTitle("discarded");
    assertThrows(IllegalStateException.class, () -> sut.create(conversation));
    assertEquals("title", sut.find("noteId", conversation.getId()).orElseThrow().getTitle());
  }

  @Test
  void persistsUpdate(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "title", "holden");
    sut.create(conversation);

    sut.update(conversation, c -> {
      c.setTitle("renamed");
      c.addMessage(Message.user("msg_1", "hello"));
    });
    var stored = sut.find("noteId", conversation.getId()).orElseThrow();

    assertEquals("renamed", stored.getTitle());
    assertEquals(1, stored.getMessages().size());
    assertEquals("hello", ((Message.User) stored.getMessages().get(0)).getContent());
  }

  @Test
  void preservesFailedUpdate(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "title", "holden");
    sut.create(conversation);

    assertThrows(IllegalStateException.class, () -> sut.update(conversation, c -> {
      c.setTitle("discarded");
      throw new IllegalStateException();
    }));
    assertEquals("title", sut.find("noteId", conversation.getId()).orElseThrow().getTitle());
  }

  @Test
  void rejectsDeletedConversation(@TempDir File directory) throws IOException {
    var sut = new FileConversationRepository(directory);
    var conversation = Conversation.create("noteId", "title", "holden");
    sut.create(conversation);

    sut.delete("noteId", conversation.getId());

    assertTrue(sut.find("noteId", conversation.getId()).isEmpty());
    assertTrue(sut.findAll("noteId").isEmpty());

    assertThrows(IOException.class, () -> sut.delete("noteId", conversation.getId()));
    assertThrows(IOException.class,
        () -> sut.update(conversation, c -> fail("update callback shouldn't run"))
    );
  }
}
