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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.openai.client.OpenAIClient;
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
  void closingUnusedModelDoesNotInitializeClient() {
    var model = new OpenAiChatModel("http://unused.invalid", "test-key", "test-model");
    model.close();
    assertThrows(IllegalStateException.class,
        () -> model.stream("instruction", List.of(), List.of(), event -> { }));
  }
}
