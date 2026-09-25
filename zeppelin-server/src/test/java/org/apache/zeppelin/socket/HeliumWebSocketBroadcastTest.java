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

import static org.apache.zeppelin.helium.HeliumPackage.newHeliumPackage;
import static org.awaitility.Awaitility.await;

import com.google.gson.JsonParser;
import com.google.gson.JsonObject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.Queue;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentLinkedQueue;

import org.apache.zeppelin.MiniZeppelinServer;
import org.apache.zeppelin.common.Message;
import org.apache.zeppelin.common.Message.OP;
import org.apache.zeppelin.helium.HeliumApplicationFactory;
import org.apache.zeppelin.helium.HeliumPackage;
import org.apache.zeppelin.helium.HeliumType;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class HeliumWebSocketBroadcastTest {
  private static MiniZeppelinServer server;

  @BeforeAll
  static void startServer() throws Exception {
    server = new MiniZeppelinServer(HeliumWebSocketBroadcastTest.class.getSimpleName());
    server.start();
  }

  @AfterAll
  static void stopServer() throws Exception {
    if (server != null) {
      server.destroy();
    }
  }

  @Test
  void applicationOutputReachesTwoWebSocketClients() throws Exception {
    Notebook notebook = server.getService(Notebook.class);
    HeliumApplicationFactory applicationFactory = server.getService(HeliumApplicationFactory.class);
    String noteId = notebook.createNote("helium-broadcast", "", AuthenticationInfo.ANONYMOUS);
    String paragraphId = notebook.processNote(noteId,
        note -> note.addNewParagraph(AuthenticationInfo.ANONYMOUS).getId());
    HeliumPackage pkg = newHeliumPackage(HeliumType.APPLICATION, "test-app", "test-app",
        "", "", new String[][]{}, "", "");
    String appId = notebook.processNote(noteId,
        note -> note.getParagraph(paragraphId).createOrGetApplicationState(pkg).getId());
    int port = server.getZeppelinConfiguration().getServerPort();
    URI uri = URI.create("ws://localhost:" + port + "/ws");
    HttpClient client = HttpClient.newHttpClient();
    RecordingWebSocketListener firstListener = new RecordingWebSocketListener();
    RecordingWebSocketListener secondListener = new RecordingWebSocketListener();
    RecordingWebSocketListener lateListener = new RecordingWebSocketListener();
    WebSocket first = null;
    WebSocket second = null;
    WebSocket late = null;
    try {
      first = client.newWebSocketBuilder()
          .header("Origin", "http://localhost:" + port)
          .buildAsync(uri, firstListener).join();
      second = client.newWebSocketBuilder()
          .header("Origin", "http://localhost:" + port)
          .buildAsync(uri, secondListener).join();
      String getNote = new Message(OP.GET_NOTE).put("id", noteId).toJson();
      first.sendText(getNote, true).join();
      second.sendText(getNote, true).join();
      await().atMost(Duration.ofSeconds(10))
          .until(() -> firstListener.hasOperation("NOTE")
              && secondListener.hasOperation("NOTE"));

      applicationFactory.onOutputUpdated(noteId, paragraphId, 0, appId,
          InterpreterResult.Type.ANGULAR, "live output");
      await().atMost(Duration.ofSeconds(10))
          .until(() -> firstListener.hasApplicationOutput(noteId, paragraphId, appId, "live output")
              && secondListener.hasApplicationOutput(noteId, paragraphId, appId, "live output"));

      late = client.newWebSocketBuilder()
          .header("Origin", "http://localhost:" + port)
          .buildAsync(uri, lateListener).join();
      late.sendText(getNote, true).join();
      await().atMost(Duration.ofSeconds(10))
          .until(() -> lateListener.hasNoteSnapshotWithOutput(
              noteId, paragraphId, appId, "live output"));
    } finally {
      if (first != null) {
        first.abort();
      }
      if (second != null) {
        second.abort();
      }
      if (late != null) {
        late.abort();
      }
      notebook.removeNote(noteId, AuthenticationInfo.ANONYMOUS);
    }
  }

  private static final class RecordingWebSocketListener implements WebSocket.Listener {
    private final StringBuilder partial = new StringBuilder();
    private final Queue<String> messages = new ConcurrentLinkedQueue<>();

    @Override
    public void onOpen(WebSocket webSocket) {
      webSocket.request(1);
    }

    @Override
    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
      partial.append(data);
      if (last) {
        messages.add(partial.toString());
        partial.setLength(0);
      }
      webSocket.request(1);
      return null;
    }

    boolean hasOperation(String operation) {
      return messages.stream().anyMatch(message ->
          operation.equals(JsonParser.parseString(message).getAsJsonObject().get("op").getAsString()));
    }

    boolean hasApplicationOutput(String noteId, String paragraphId, String appId,
                                 String output) {
      return messages.stream().anyMatch(message ->
          isApplicationOutput(message, noteId, paragraphId, appId, output));
    }

    private boolean isApplicationOutput(String message, String noteId, String paragraphId,
                                        String appId, String output) {
      JsonObject root = JsonParser.parseString(message).getAsJsonObject();
      if (!"APP_UPDATE_OUTPUT".equals(root.get("op").getAsString())) {
        return false;
      }
      JsonObject data = root.getAsJsonObject("data");
      return noteId.equals(data.get("noteId").getAsString())
          && paragraphId.equals(data.get("paragraphId").getAsString())
          && appId.equals(data.get("appId").getAsString())
          && output.equals(data.get("data").getAsString());
    }

    boolean hasNoteSnapshotWithOutput(String noteId, String paragraphId, String appId,
                                      String output) {
      return messages.stream().anyMatch(message ->
          isNoteSnapshotWithOutput(message, noteId, paragraphId, appId, output));
    }

    private boolean isNoteSnapshotWithOutput(String message, String noteId, String paragraphId,
                                             String appId, String output) {
      JsonObject root = JsonParser.parseString(message).getAsJsonObject();
      if (!"NOTE".equals(root.get("op").getAsString())) {
        return false;
      }
      JsonObject note = root.getAsJsonObject("data").getAsJsonObject("note");
      if (!noteId.equals(note.get("id").getAsString())) {
        return false;
      }
      for (var paragraph : note.getAsJsonArray("paragraphs")) {
        JsonObject p = paragraph.getAsJsonObject();
        if (paragraphId.equals(p.get("id").getAsString())) {
          for (var application : p.getAsJsonArray("apps")) {
            JsonObject app = application.getAsJsonObject();
            if (appId.equals(app.get("id").getAsString())
                && output.equals(app.get("output").getAsString())) {
              return true;
            }
          }
        }
      }
      return false;
    }
  }
}
