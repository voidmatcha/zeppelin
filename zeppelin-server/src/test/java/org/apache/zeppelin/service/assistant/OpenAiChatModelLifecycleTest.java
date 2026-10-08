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

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.openai.client.OpenAIClient;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

class OpenAiChatModelLifecycleTest {
  @Test
  void closesOwnedClientOnceAndRejectsReuse() throws Exception {
    var model = new OpenAiChatModel("http://unused.invalid", "test-key", "test-model");
    var client = mock(OpenAIClient.class);
    var field = OpenAiChatModel.class.getDeclaredField("cachedClient");
    field.setAccessible(true);
    field.set(model, client);

    model.close();
    model.close();

    verify(client, times(1)).close();
    assertThrows(IllegalStateException.class,
        () -> model.stream("instruction", List.of(), List.of(), event -> { }));
  }

  @Test
  void closingModelCancelsAStalledHttpStream() throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var streaming = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    server.createContext("/responses", exchange -> {
      exchange.getRequestBody().readAllBytes();
      exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
      exchange.sendResponseHeaders(200, 0);
      try (var body = exchange.getResponseBody()) {
        body.write(": waiting\n\n".getBytes(StandardCharsets.UTF_8));
        body.flush();
        streaming.countDown();
        try {
          release.await();
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    });
    server.start();
    var worker = Executors.newFixedThreadPool(2);
    var model = new OpenAiChatModel(
        "http://127.0.0.1:" + server.getAddress().getPort(), "test-key", "test-model");
    try {
      var run = worker.submit(() -> model.stream("instruction", List.of(), List.of(), event -> { }));
      assertTrue(streaming.await(5, TimeUnit.SECONDS));
      worker.submit(model::close).get(3, TimeUnit.SECONDS);
      assertThrows(ExecutionException.class, () -> run.get(3, TimeUnit.SECONDS));
    } finally {
      release.countDown();
      server.stop(0);
      model.close();
      worker.shutdownNow();
      assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS));
    }
  }

  @Test
  void closingUnusedModelDoesNotInitializeClient() {
    var model = new OpenAiChatModel("http://unused.invalid", "test-key", "test-model");
    model.close();
    assertThrows(IllegalStateException.class,
        () -> model.stream("instruction", List.of(), List.of(), event -> { }));
  }
}
