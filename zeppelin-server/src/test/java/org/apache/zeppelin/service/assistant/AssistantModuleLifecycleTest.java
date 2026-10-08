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
import static org.mockito.Mockito.verify;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;

class AssistantModuleLifecycleTest {
  @Test
  void shutdownInterruptsActiveRunsCancelsQueueAndRejectsSubmissions() throws Exception {
    var module = new AssistantModule(true, "http://127.0.0.1", "key", "model", ".", null, null, null);
    var field = AssistantModule.class.getDeclaredField("assistantExecutor");
    field.setAccessible(true);
    var executor = (ExecutorService) field.get(module);
    var active = new CountDownLatch(10);
    var interrupted = new CountDownLatch(10);
    var release = new CountDownLatch(1);
    try {
      for (int i = 0; i < 10; i++) {
        executor.submit(() -> {
          active.countDown();
          try {
            release.await();
          } catch (InterruptedException e) {
            interrupted.countDown();
            Thread.currentThread().interrupt();
          }
        });
      }
      assertTrue(active.await(5, TimeUnit.SECONDS));
      var queued = executor.submit(() -> { throw new AssertionError("Queued run started"); });
      module.close();
      assertTrue(interrupted.await(5, TimeUnit.SECONDS));
      assertTrue(queued.isCancelled());
      assertTrue(executor.isTerminated());
      assertThrows(RejectedExecutionException.class, () -> executor.submit(() -> { }));
    } finally {
      release.countDown();
      executor.shutdownNow();
    }
  }
}
