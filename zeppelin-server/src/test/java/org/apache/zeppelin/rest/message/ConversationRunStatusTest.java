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

package org.apache.zeppelin.rest.message;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import org.apache.zeppelin.service.assistant.Conversation;
import org.junit.jupiter.api.Test;

class ConversationRunStatusTest {
  private final Gson gson = new Gson();

  @Test
  void exposesTransientRunStatusWithoutChangingStoredConversation() {
    var conversation = Conversation.create("note", "title", "owner");
    var runningMetadata = gson.toJsonTree(ConversationMetadata.of(conversation, "owner", true))
        .getAsJsonObject();
    var idleMetadata = gson.toJsonTree(ConversationMetadata.of(conversation, "owner", false))
        .getAsJsonObject();
    var runningResponse = gson.toJsonTree(ConversationResponse.of(conversation, "reader", true))
        .getAsJsonObject();
    var idleResponse = gson.toJsonTree(ConversationResponse.of(conversation, "owner", false))
        .getAsJsonObject();

    assertTrue(runningMetadata.get("running").getAsBoolean());
    assertFalse(idleMetadata.get("running").getAsBoolean());
    assertTrue(runningResponse.get("running").getAsBoolean());
    assertFalse(idleResponse.get("running").getAsBoolean());
    assertFalse(runningResponse.get("canSendMessage").getAsBoolean());
    assertEquals(conversation.getId(), runningResponse.get("id").getAsString());
    assertFalse(gson.toJsonTree(conversation).getAsJsonObject().has("running"));
  }
}
