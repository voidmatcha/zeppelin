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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import com.google.gson.JsonParser;
import java.util.Set;
import java.util.concurrent.RejectedExecutionException;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.service.assistant.Assistant;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class NotebookServerAssistantLifecycleTest {
  @Test
  void saturatedAssistantExecutorReportsTooManyRequests() throws Exception {
    var server = new NotebookServer();
    var service = mock(Assistant.class);
    server.setAssistant(() -> service);
    var socket = mock(NotebookSocket.class);
    doThrow(new RejectedExecutionException()).when(service).sendMessage(
        any(), any(), any(), any(), any(), any());
    var send = NotebookServer.class.getDeclaredMethod("sendAssistantMessage",
        NotebookSocket.class, ServiceContext.class, Message.class);
    send.setAccessible(true);
    send.invoke(server, socket,
        new ServiceContext(AuthenticationInfo.ANONYMOUS, Set.of()),
        new Message(OP.ASSISTANT_SEND_MESSAGE).put("noteId", "note")
            .put("conversationId", "conversation").put("content", "hello"));
    var response = ArgumentCaptor.forClass(String.class);
    verify(socket).send(response.capture());
    var message = JsonParser.parseString(response.getValue()).getAsJsonObject();
    assertEquals("ASSISTANT_EVENT", message.get("op").getAsString());
    var data = message.getAsJsonObject("data");
    assertEquals("conversation", data.get("conversationId").getAsString());
    assertEquals("run.failed", data.get("type").getAsString());
    var payload = data.getAsJsonObject("payload");
    assertTrue(!payload.get("runId").getAsString().isEmpty());
    assertEquals(429, payload.getAsJsonObject("error").get("status").getAsInt());
    verify(service).sendMessage(any(), any(), any(), any(), any(), any());
    verifyNoMoreInteractions(service);
  }
}
