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
package org.apache.zeppelin.interpreter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.ObjectOutputStream;
import java.io.Serializable;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.interpreter.remote.AppendOutputRunner;
import org.apache.zeppelin.interpreter.remote.InvokeResourceMethodEventMessage;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterProcess;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterProcessListener;
import org.apache.zeppelin.interpreter.thrift.InterpreterRPCException;
import org.apache.zeppelin.interpreter.thrift.OutputAppendEvent;
import org.apache.zeppelin.interpreter.thrift.OutputUpdateAllEvent;
import org.apache.zeppelin.interpreter.thrift.OutputUpdateEvent;
import org.apache.zeppelin.interpreter.thrift.RemoteInterpreterResultMessage;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.resource.Resource;
import org.apache.zeppelin.resource.ResourceId;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

public class RemoteInterpreterEventServerTest {
  
  @Test
  void forwardsExecutionIdentityThroughEveryOutputRpc() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    InterpreterSettingManager manager = mock(InterpreterSettingManager.class);
    when(manager.getRemoteInterpreterProcessListener()).thenReturn(listener);
    RemoteInterpreterEventServer server = new RemoteInterpreterEventServer(
        mock(ZeppelinConfiguration.class), manager);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    Field runnerField = RemoteInterpreterEventServer.class.getDeclaredField("runner");
    runnerField.setAccessible(true);
    runnerField.set(server, runner);
    try {
      server.appendOutput(new OutputAppendEvent("note", "para", 0, "append", null)
          .setUser("alice"));
      server.updateOutput(new OutputUpdateEvent("note", "para", 0, "TEXT", "update", null)
          .setUser("bob"));
      server.updateAllOutput(new OutputUpdateAllEvent("note", "para", Collections.emptyList())
          .setUser("alice"));
      server.checkpointOutput("note", "para", "bob", "true");
      InOrder order = inOrder(listener);
      order.verify(listener).onOutputAppendForUser("note", "para", 0, "append", "alice");
      order.verify(listener).onOutputUpdatedForUser(
          "note", "para", 0, InterpreterResult.Type.TEXT, "update", "bob");
      order.verify(listener).onOutputClearForUser("note", "para", "alice");
      order.verify(listener).prepareCheckpointOutput("note", "para", "bob", true);
      server.checkpointOutput("note", "para", "bob", "false");
      order.verify(listener).prepareCheckpointOutput("note", "para", "bob", false);
      server.checkpointOutput("note", "para", "bob");
      order.verify(listener).prepareCheckpointOutput("note", "para", "bob");
      server.checkpointOutput("note", "para", "bob", "unknown");
      order.verifyNoMoreInteractions();
    } finally {
      server.stop();
    }
  }

  @Test
  void checkpointIncludesQueuedOutput() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    InterpreterSettingManager manager = mock(InterpreterSettingManager.class);
    when(manager.getRemoteInterpreterProcessListener()).thenReturn(listener);
    RemoteInterpreterEventServer server = new RemoteInterpreterEventServer(
        mock(ZeppelinConfiguration.class), manager);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    Field runnerField = RemoteInterpreterEventServer.class.getDeclaredField("runner");
    runnerField.setAccessible(true);
    runnerField.set(server, runner);
    doCallRealMethod().when(listener).prepareCheckpointOutput("note", "para", null);
    Paragraph paragraph = new Paragraph("para", null, null);
    paragraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "old");
    doAnswer(invocation -> {
      paragraph.updateOutputBuffer(0, InterpreterResult.Type.TEXT, "new");
      return null;
    }).when(listener).onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "new");
    doAnswer(invocation -> {
      paragraph.checkpointOutput();
      return null;
    }).when(listener).checkpointOutput("note", "para");

    try {
      server.updateOutput(new OutputUpdateEvent("note", "para", 0, "TEXT", "new", null));
      server.checkpointOutput("note", "para");

      assertEquals("new", paragraph.getReturn().message().get(0).getData());
    } finally {
      server.stop();
    }
  }

  @Test
  void checkpointWaitsForInFlightOutput() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    InterpreterSettingManager manager = mock(InterpreterSettingManager.class);
    when(manager.getRemoteInterpreterProcessListener()).thenReturn(listener);
    RemoteInterpreterEventServer server = new RemoteInterpreterEventServer(
        mock(ZeppelinConfiguration.class), manager);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    Field runnerField = RemoteInterpreterEventServer.class.getDeclaredField("runner");
    runnerField.setAccessible(true);
    runnerField.set(server, runner);
    CountDownLatch updateStarted = new CountDownLatch(1);
    CountDownLatch releaseUpdate = new CountDownLatch(1);
    CountDownLatch checkpointRequested = new CountDownLatch(1);
    doCallRealMethod().when(listener).prepareCheckpointOutput("note", "para", null);
    doAnswer(invocation -> {
      updateStarted.countDown();
      assertTrue(releaseUpdate.await(5, TimeUnit.SECONDS));
      return null;
    }).when(listener).onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "new");
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      server.updateOutput(new OutputUpdateEvent("note", "para", 0, "TEXT", "new", null));
      Future<?> drain = executor.submit(runner);
      assertTrue(updateStarted.await(5, TimeUnit.SECONDS));
      Future<?> checkpoint = executor.submit(() -> {
        checkpointRequested.countDown();
        server.checkpointOutput("note", "para");
        return null;
      });
      assertTrue(checkpointRequested.await(5, TimeUnit.SECONDS));
      assertThrows(TimeoutException.class, () -> checkpoint.get(100, TimeUnit.MILLISECONDS));
      releaseUpdate.countDown();
      drain.get(5, TimeUnit.SECONDS);
      checkpoint.get(5, TimeUnit.SECONDS);
      InOrder order = inOrder(listener);
      order.verify(listener).onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "new");
      order.verify(listener).checkpointOutput("note", "para");
    } finally {
      releaseUpdate.countDown();
      executor.shutdownNow();
      server.stop();
    }
  }

  @Test
  void updateAllWaitsForInFlightOutput() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    CountDownLatch appendStarted = new CountDownLatch(1);
    CountDownLatch releaseAppend = new CountDownLatch(1);
    CountDownLatch clearRequested = new CountDownLatch(1);
    doAnswer(invocation -> {
      appendStarted.countDown();
      assertTrue(releaseAppend.await(5, TimeUnit.SECONDS));
      return null;
    }).when(listener).onOutputAppend("note", "para", 0, "before");

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      runner.appendBuffer("note", "para", 0, "before");
      Future<?> drain = executor.submit(runner);
      assertTrue(appendStarted.await(5, TimeUnit.SECONDS));
      Future<?> clear = executor.submit(() -> {
        clearRequested.countDown();
        runner.updateAllBuffer("note", "para", Collections.emptyList());
      });
      assertTrue(clearRequested.await(5, TimeUnit.SECONDS));
      assertThrows(TimeoutException.class, () -> clear.get(100, TimeUnit.MILLISECONDS));
      releaseAppend.countDown();
      drain.get(5, TimeUnit.SECONDS);
      clear.get(5, TimeUnit.SECONDS);

      InOrder order = inOrder(listener);
      order.verify(listener).onOutputAppend("note", "para", 0, "before");
      order.verify(listener).onOutputClear("note", "para");
      order.verifyNoMoreInteractions();
    } finally {
      releaseAppend.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void updateAllOutputPreservesQueuedOutputOrder() throws Exception {
    ZeppelinConfiguration zConf = mock(ZeppelinConfiguration.class);
    InterpreterSettingManager manager = mock(InterpreterSettingManager.class);
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    when(manager.getRemoteInterpreterProcessListener()).thenReturn(listener);
    RemoteInterpreterEventServer server = new RemoteInterpreterEventServer(zConf, manager);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    Field runnerField = RemoteInterpreterEventServer.class.getDeclaredField("runner");
    runnerField.setAccessible(true);
    runnerField.set(server, runner);

    try {
      server.appendOutput(new OutputAppendEvent("note", "para", 0, "before", null));
      server.updateOutput(new OutputUpdateEvent("note", "para", 0, "TEXT", "old", null));
      server.updateAllOutput(new OutputUpdateAllEvent("note", "para", Arrays.asList(
          new RemoteInterpreterResultMessage("TEXT", "replacement"),
          new RemoteInterpreterResultMessage("HTML", "<b>replacement</b>"))));
      InOrder order = inOrder(listener);
      order.verify(listener).onOutputAppend("note", "para", 0, "before");
      order.verify(listener).onOutputUpdated("note", "para", 0, InterpreterResult.Type.TEXT, "old");
      order.verify(listener).onOutputClear("note", "para");
      order.verify(listener).onOutputUpdated(
          "note", "para", 0, InterpreterResult.Type.TEXT, "replacement");
      order.verify(listener).onOutputUpdated(
          "note", "para", 1, InterpreterResult.Type.HTML, "<b>replacement</b>");
      server.appendOutput(new OutputAppendEvent("note", "para", 0, "after", null));
      server.updateAllOutput(new OutputUpdateAllEvent("note", "para", Collections.emptyList()));
      order.verify(listener).onOutputAppend("note", "para", 0, "after");
      order.verify(listener).onOutputClear("note", "para");
      server.appendOutput(new OutputAppendEvent("note", "para", 0, "new", null));
      runner.run();
      order.verify(listener).onOutputAppend("note", "para", 0, "new");
      order.verifyNoMoreInteractions();
    } finally {
      server.stop();
    }
  }

  @Test
  void invokeMethodThrowsRpcExceptionWhenSerializationFails() throws Exception {
    ZeppelinConfiguration zConf = mock(ZeppelinConfiguration.class);
    InterpreterSettingManager manager = mock(InterpreterSettingManager.class);
    RemoteInterpreterEventServer server = new RemoteInterpreterEventServer(zConf, manager);

    ManagedInterpreterGroup interpreterGroup = mock(ManagedInterpreterGroup.class);
    RemoteInterpreterProcess remoteInterpreterProcess = mock(RemoteInterpreterProcess.class);
      
    when(manager.getInterpreterGroupById("pool-id"))
        .thenReturn(interpreterGroup);
    when(interpreterGroup.getRemoteInterpreterProcess())
        .thenReturn(remoteInterpreterProcess);
    when(remoteInterpreterProcess.isRunning())
        .thenReturn(true);
      
    ByteBuffer remoteResult = Resource.serializeObject(new SerializableOnlyOnce());
    doReturn(remoteResult)
        .when(remoteInterpreterProcess)
        .callRemoteFunction(any());
      
    ResourceId resourceId = ResourceId.fromJson(
        "{\"resourcePoolId\":\"pool-id\",\"name\":\"resource-name\",\"noteId\":\"note-id\",\"paragraphId\":\"paragraph-id\"}"
    );

    InvokeResourceMethodEventMessage message = new InvokeResourceMethodEventMessage(
        resourceId
        , "someMethod"
        , null
        , null
        , null);

    InterpreterRPCException exception = assertThrows(
        InterpreterRPCException.class,
        () -> server.invokeMethod("caller-group-id", message.toJson()));
      
    assertTrue(exception.toString().contains("failed on second serialization"));
  }
  private static class SerializableOnlyOnce implements Serializable {
    private static final long serialVersionUID = 1L;
    private static final int FAILURE_SERIALIZATION_COUNT = 2;

    private int serializationCount;

    private void writeObject(ObjectOutputStream outputStream) throws IOException {
      serializationCount++;

      if (serializationCount == FAILURE_SERIALIZATION_COUNT) {
        throw new IOException("failed on second serialization");
      }
      
      outputStream.defaultWriteObject();
    }
  }
}
