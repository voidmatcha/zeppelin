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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.service.assistant.Assistant;
import org.apache.zeppelin.service.assistant.AssistantEventListener;
import org.apache.zeppelin.service.assistant.AssistantEventType;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class NotebookServerAssistantTest {
  @Test
  void testAssistantEventsKeepTheirRequestMsgId() throws IOException {
    NotebookServer notebookServer = new NotebookServer();
    ZeppelinConfiguration conf = mock(ZeppelinConfiguration.class);
    when(conf.isAnonymousAllowed()).thenReturn(true);
    notebookServer.setZeppelinConfiguration(conf);
    Assistant assistant = mock(Assistant.class);
    notebookServer.setAssistant(() -> assistant);
    NotebookSocket socket = mock(NotebookSocket.class);
    when(socket.getUser()).thenReturn("anonymous");
    try {
      for (String requestId : Arrays.asList("assistant-a", "assistant-b")) {
        notebookServer.onMessage(socket, new Message(OP.ASSISTANT_SEND_MESSAGE)
            .withMsgId(requestId)
            .put("noteId", "note")
            .put("conversationId", "conversation")
            .put("content", requestId).toJson());
      }
      ArgumentCaptor<AssistantEventListener> listeners =
          ArgumentCaptor.forClass(AssistantEventListener.class);
      verify(assistant, times(2)).sendMessage(eq("note"), eq("conversation"), anyString(),
          Mockito.any(AuthenticationInfo.class), Mockito.anySet(), listeners.capture());
      // A delayed callback must retain its own request id after another send.
      for (AssistantEventType type : AssistantEventType.values()) {
        listeners.getAllValues().get(1).onEvent(type, null);
        listeners.getAllValues().get(0).onEvent(type, null);
      }
      ArgumentCaptor<String> frames = ArgumentCaptor.forClass(String.class);
      verify(socket, times(AssistantEventType.values().length * 2)).send(frames.capture());
      List<String> sent = frames.getAllValues();
      assertEquals(AssistantEventType.values().length * 2, sent.size());
      for (int index = 0; index < sent.size(); index++) {
        Message event = notebookServer.deserializeMessage(sent.get(index));
        assertEquals(OP.ASSISTANT_EVENT, event.op);
        assertEquals(index % 2 == 0 ? "assistant-b" : "assistant-a", event.msgId);
        assertEquals("conversation", event.get("conversationId"));
        assertEquals(AssistantEventType.values()[index / 2].wireName, event.get("type"));
      }
    } finally {
      notebookServer.close();
    }
  }

}
