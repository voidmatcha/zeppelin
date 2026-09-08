/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.apache.zeppelin.flink.sql;

import org.apache.flink.types.Row;
import org.apache.zeppelin.display.AngularObjectRegistry;
import org.apache.zeppelin.interpreter.InterpreterContext;
import org.apache.zeppelin.interpreter.InterpreterOutput;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterEventClient;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.Test;

import java.util.HashMap;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

public class SingleRowStreamSqlJobTest {

  @Test
  public void testRefreshWithoutAuthentication() throws Exception {
    assertRefreshCheckpointUser(null, null, null);
  }

  @Test
  public void testRefreshWithAuthentication() throws Exception {
    assertRefreshCheckpointUser(new AuthenticationInfo("alice"), "alice", null);
  }

  @Test
  public void testRefreshWithCapturedPersonalizedMode() throws Exception {
    assertRefreshCheckpointUser(new AuthenticationInfo("alice"), "alice", "true");
  }

  @Test
  public void testRefreshWithCapturedSharedMode() throws Exception {
    assertRefreshCheckpointUser(new AuthenticationInfo("alice"), "alice", "false");
  }

  private void assertRefreshCheckpointUser(AuthenticationInfo authentication, String expectedUser,
                                          String mode)
      throws Exception {
    RemoteInterpreterEventClient eventClient = mock(RemoteInterpreterEventClient.class);
    AngularObjectRegistry registry = mock(AngularObjectRegistry.class);
    try (InterpreterOutput output = new InterpreterOutput()) {
      InterpreterContext context = InterpreterContext.builder()
          .setNoteId("note")
          .setParagraphId("paragraph")
          .setLocalProperties(new HashMap<>())
          .setAuthenticationInfo(authentication)
          .setInterpreterOut(output)
          .setAngularObjectRegistry(registry)
          .setIntpEventClient(eventClient)
          .build();
      if (mode != null) {
        context.getLocalProperties().put(InterpreterContext.OUTPUT_PERSONALIZED_MODE, mode);
      }
      SingleRowStreamSqlJob job = new SingleRowStreamSqlJob(null, null, null, context, 1, null);
      try {
        job.processInsert(Row.of(42));
        job.refresh(context);
        assertEquals(InterpreterResult.Type.ANGULAR,
            output.toInterpreterResultMessage().get(0).getType());
        verify(eventClient).checkpointOutput("note", "paragraph", expectedUser, mode);
        verify(registry).add("value_0", "42", "note", "paragraph");
      } finally {
        job.refreshScheduler.shutdownNow();
      }
    }
  }
}
