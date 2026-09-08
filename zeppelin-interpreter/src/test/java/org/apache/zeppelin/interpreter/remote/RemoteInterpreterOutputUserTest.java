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

package org.apache.zeppelin.interpreter.remote;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.apache.thrift.TDeserializer;
import org.apache.thrift.TException;
import org.apache.thrift.TSerializer;
import org.apache.zeppelin.interpreter.InterpreterContext;
import org.apache.zeppelin.interpreter.InterpreterGroup;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.thrift.OutputAppendEvent;
import org.apache.zeppelin.interpreter.thrift.OutputUpdateAllEvent;
import org.apache.zeppelin.interpreter.thrift.OutputUpdateEvent;
import org.apache.zeppelin.interpreter.thrift.RemoteInterpreterContext;
import org.apache.zeppelin.interpreter.thrift.RemoteInterpreterEventService;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.Test;

class RemoteInterpreterOutputUserTest {
  private static class CapturingClient extends RemoteInterpreterEventClient {
    private final RemoteInterpreterEventService.Client receiver =
        mock(RemoteInterpreterEventService.Client.class);

    CapturingClient() {
      super("localhost", 0, 1);
    }

    @Override
    public <R> R callRemoteFunction(
        PooledRemoteClient.RemoteFunction<R, RemoteInterpreterEventService.Client> function) {
      try {
        return function.call(receiver);
      } catch (TException e) {
        throw new IllegalStateException(e);
      }
    }
  }

  @Test
  void asynchronousOutputKeepsTheAuthenticatedExecutionUser() throws Exception {
    assertAsynchronousOutputKeepsExecutionScope(true);
  }

  @Test
  void asynchronousSharedOutputKeepsItsScopeWhenTheContextChanges() throws Exception {
    assertAsynchronousOutputKeepsExecutionScope(false);
  }

  private void assertAsynchronousOutputKeepsExecutionScope(boolean personalized) throws Exception {
    CapturingClient client = new CapturingClient();
    RemoteInterpreterServer server = new RemoteInterpreterServer("localhost", 0, ":", "group", true);
    server.intpEventClient = client;
    Field group = RemoteInterpreterServer.class.getDeclaredField("interpreterGroup");
    group.setAccessible(true);
    group.set(server, mock(InterpreterGroup.class));
    RemoteInterpreterContext remote = new RemoteInterpreterContext();
    remote.setNoteId("note");
    remote.setParagraphId("para");
    remote.setAuthenticationInfo(new AuthenticationInfo("alice").toJson());
    remote.setGui("{}");
    remote.setNoteGui("{}");
    remote.setConfig("{}");
    remote.setLocalProperties(new HashMap<>());
    remote.getLocalProperties().put(InterpreterContext.OUTPUT_PERSONALIZED_MODE,
        Boolean.toString(personalized));
    Method convert = RemoteInterpreterServer.class.getDeclaredMethod(
        "convert", RemoteInterpreterContext.class);
    convert.setAccessible(true);
    InterpreterContext context = (InterpreterContext) convert.invoke(server, remote);
    remote.getLocalProperties().put(InterpreterContext.OUTPUT_PERSONALIZED_MODE,
        Boolean.toString(!personalized));
    ExecutorService executor = Executors.newSingleThreadExecutor();
    try {
      executor.submit(() -> {
        InterpreterContext.set(InterpreterContext.builder()
            .setAuthenticationInfo(new AuthenticationInfo("bob")).build());
        try {
          context.out().write("alice output\n");
          context.out().flush();
          context.out().clear();
        } finally {
          InterpreterContext.remove();
        }
        return null;
      }).get(5, TimeUnit.SECONDS);
      verify(client.receiver, atLeastOnce()).appendOutput(argThat(event ->
          "alice".equals(event.getUser()) && event.getData().contains("alice output")
              && event.isSetPersonalized() && event.isPersonalized() == personalized));
      verify(client.receiver, atLeastOnce()).updateOutput(argThat(event ->
          "alice".equals(event.getUser()) && event.isSetPersonalized()
              && event.isPersonalized() == personalized));
      verify(client.receiver, atLeastOnce()).updateAllOutput(argThat(event ->
          "alice".equals(event.getUser()) && event.isSetPersonalized()
              && event.isPersonalized() == personalized));
    } finally {
      executor.shutdownNow();
      client.close();
    }
  }

  @Test
  void checkpointCarriesItsExplicitUser() throws Exception {
    try (CapturingClient client = new CapturingClient()) {
      client.checkpointOutput("note", "para", "bob");
      verify(client.receiver).checkpointOutput("note", "para", "bob", null);
    }
  }

  @Test
  void checkpointCarriesCapturedModeWithoutInferringMissingMetadata() throws Exception {
    for (String mode : new String[] {null, "false", "true"}) {
      try (CapturingClient client = new CapturingClient()) {
        client.checkpointOutput("note", "para", "alice", mode);
        verify(client.receiver).checkpointOutput("note", "para", "alice", mode);
      }
    }
  }

  @Test
  void checkpointModePreservesAbsentAndExplicitFalseAtTheRpcBoundary() throws Exception {
    for (String mode : new String[] {null, "false", "true"}) {
      RemoteInterpreterEventService.checkpointOutput_args args =
          new RemoteInterpreterEventService.checkpointOutput_args()
              .setNoteId("note").setParagraphId("para").setUser("alice")
              .setOutputPersonalizedMode(mode);
      RemoteInterpreterEventService.checkpointOutput_args decoded =
          new RemoteInterpreterEventService.checkpointOutput_args();
      new TDeserializer().deserialize(decoded, new TSerializer().serialize(args));
      assertEquals(mode != null, decoded.isSetOutputPersonalizedMode());
      assertEquals(mode, decoded.getOutputPersonalizedMode());
      RemoteInterpreterEventService.Iface receiver = mock(RemoteInterpreterEventService.Iface.class);
      new RemoteInterpreterEventService.Processor.checkpointOutput<>()
          .getResult(receiver, decoded);
      verify(receiver).checkpointOutput("note", "para", "alice", mode);
    }
  }

  @Test
  void legacyCallerDoesNotInferAnExecutionUser() throws Exception {
    try (CapturingClient client = new CapturingClient()) {
      client.onInterpreterOutputAppend("note", "para", 0, "legacy");
      verify(client.receiver).appendOutput(argThat(event ->
          event.getUser() == null && !event.isSetPersonalized()));
      client.onInterpreterOutputUpdate("note", "para", 0,
          InterpreterResult.Type.TEXT, "legacy", "alice");
      client.onInterpreterOutputUpdateAll("note", "para", Collections.emptyList(), "alice");
      verify(client.receiver).updateOutput(argThat(event -> !event.isSetPersonalized()));
      verify(client.receiver).updateAllOutput(argThat(event -> !event.isSetPersonalized()));
      client.checkpointOutput("note", "para");
      verify(client.receiver).checkpointOutput("note", "para", null, null);
    }
  }

  @Test
  void personalizedScopeIsOptionalAndPreservesExplicitFalseOnTheWire() throws Exception {
    TSerializer serializer = new TSerializer();
    TDeserializer deserializer = new TDeserializer();
    for (Boolean mode : new Boolean[] {null, false, true}) {
      OutputAppendEvent append = new OutputAppendEvent("note", "para", 0, "chunk", null);
      OutputUpdateEvent update = new OutputUpdateEvent("note", "para", 0, "TEXT", "chunk", null);
      OutputUpdateAllEvent all = new OutputUpdateAllEvent("note", "para", Collections.emptyList());
      if (mode != null) {
        append.setPersonalized(mode);
        update.setPersonalized(mode);
        all.setPersonalized(mode);
      }
      OutputAppendEvent decodedAppend = new OutputAppendEvent();
      OutputUpdateEvent decodedUpdate = new OutputUpdateEvent();
      OutputUpdateAllEvent decodedAll = new OutputUpdateAllEvent();
      deserializer.deserialize(decodedAppend, serializer.serialize(append));
      deserializer.deserialize(decodedUpdate, serializer.serialize(update));
      deserializer.deserialize(decodedAll, serializer.serialize(all));
      assertEquals(mode, decodedAppend.isSetPersonalized() ? decodedAppend.isPersonalized() : null);
      assertEquals(mode, decodedUpdate.isSetPersonalized() ? decodedUpdate.isPersonalized() : null);
      assertEquals(mode, decodedAll.isSetPersonalized() ? decodedAll.isPersonalized() : null);
    }
  }

  @Test
  void userIsOptionalOnTheWire() throws Exception {
    TSerializer serializer = new TSerializer();
    TDeserializer deserializer = new TDeserializer();
    OutputAppendEvent event = new OutputAppendEvent("note", "para", 0, "chunk", null);
    OutputAppendEvent decoded = new OutputAppendEvent();
    deserializer.deserialize(decoded, serializer.serialize(event));
    assertNull(decoded.getUser());
    event.setUser("alice");
    deserializer.deserialize(decoded, serializer.serialize(event));
    assertEquals("alice", decoded.getUser());
    assertEquals("chunk", decoded.getData());
  }
}
