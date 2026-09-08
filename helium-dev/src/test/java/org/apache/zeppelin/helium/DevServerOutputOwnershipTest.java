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

package org.apache.zeppelin.helium;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verify;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import org.apache.zeppelin.interpreter.InterpreterContext;
import org.apache.zeppelin.interpreter.InterpreterGroup;
import org.apache.zeppelin.interpreter.InterpreterOutput;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterEventClient;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterServer;
import org.apache.zeppelin.interpreter.thrift.RemoteInterpreterContext;
import org.apache.zeppelin.resource.ResourceSet;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.Test;

class DevServerOutputOwnershipTest {
  @Test
  void developerOutputsKeepTheirOriginalExecutionIdentity() throws Exception {
    TestDevServer server = new TestDevServer();
    try (InterpreterOutput alice = server.createInterpreterOutput("note", "para", "alice");
         InterpreterOutput bob = server.createInterpreterOutput("note", "para", "bob")) {
      assertNotSame(alice, bob);
      bob.write("bob output\n");
      bob.flush();
      alice.write("alice late output\n");
      alice.flush();
      verify(server.client).onInterpreterOutputAppend("note", "para", 0, "bob output\n", "bob");
      verify(server.client).onInterpreterOutputAppend(
          "note", "para", 0, "alice late output\n", "alice");
      bob.clear();
      verify(server.client).onInterpreterOutputUpdateAll("note", "para", List.of(), "bob");
      server.fileChanged(new File("changed-resource"));
      assertEquals(1, server.refreshCount);
    }
  }

  @Test
  void outputIdentityIncludesTheNoteAndParagraph() throws Exception {
    TestDevServer server = new TestDevServer();
    try (InterpreterOutput first = server.createInterpreterOutput("first", "p1", "alice");
         InterpreterOutput second = server.createInterpreterOutput("second", "p2", "alice")) {
      second.write("second output\n");
      first.write("first output\n");
      verify(server.client).onInterpreterOutputAppend(
          "second", "p2", 0, "second output\n", "alice");
      verify(server.client).onInterpreterOutputAppend(
          "first", "p1", 0, "first output\n", "alice");
    }
  }

  @Test
  void applicationsRebindByCreatingANewInstanceWithoutRetargetingTheOldContext() throws Exception {
    TestApplication.instances.clear();
    TestApplicationServer server = new TestApplicationServer();
    try (InterpreterOutput alice = server.createInterpreterOutput("note", "para", "alice");
         InterpreterOutput bob = server.createInterpreterOutput("note", "para", "bob")) {
      InterpreterContext aliceContext = context(alice);
      assertEquals(InterpreterResult.Code.SUCCESS, server.interpret("", aliceContext).code());
      TestApplication oldApp = TestApplication.instances.get(0);
      assertSame(alice, oldApp.context().out);
      // Reusing one execution context preserves dev application state for reruns.
      server.interpret("", aliceContext);
      assertEquals(1, TestApplication.instances.size());
      assertEquals(2, oldApp.runs);
      assertEquals(InterpreterResult.Code.SUCCESS, server.interpret("", context(bob)).code());
      assertEquals(2, TestApplication.instances.size());
      TestApplication newApp = TestApplication.instances.get(1);
      assertNotSame(oldApp, newApp);
      assertSame(bob, newApp.context().out);
      assertSame(alice, oldApp.context().out);
      assertEquals(1, oldApp.unloads);
      bob.flush();
      verify(server.client, atLeastOnce()).onInterpreterOutputUpdate(eq("note"), eq("para"),
          eq(0), eq(InterpreterResult.Type.ANGULAR), anyString(), eq("bob"));
      oldApp.println("late old application output");
      oldApp.context().out.flush();
      assertTrue(mockingDetails(server.client).getInvocations().stream()
          .filter(call -> call.getMethod().getName().equals("onInterpreterOutputUpdate"))
          .filter(call -> ((String) call.getArgument(4)).contains("late old application output"))
          .allMatch(call -> "alice".equals(call.getArgument(5))));
      verify(server.client, atLeastOnce()).onInterpreterOutputUpdate(eq("note"), eq("para"),
          eq(0), eq(InterpreterResult.Type.ANGULAR),
          org.mockito.ArgumentMatchers.contains("late old application output"), eq("alice"));
    }
  }

  @Test
  void bothDevelopmentServersCapturePrivacyScopeFromTheRemoteExecutionContext() throws Exception {
    TestDevServer dev = new TestDevServer();
    assertCapturedScope(dev, dev.client);
    TestApplicationServer application = new TestApplicationServer();
    assertCapturedScope(application, application.client);
  }

  private void assertCapturedScope(ZeppelinDevServer server, RemoteInterpreterEventClient client)
      throws Exception {
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
    remote.getLocalProperties().put(InterpreterContext.OUTPUT_PERSONALIZED_MODE, "true");
    Method convert = RemoteInterpreterServer.class.getDeclaredMethod(
        "convert", RemoteInterpreterContext.class);
    convert.setAccessible(true);
    InterpreterContext alice = (InterpreterContext) convert.invoke(server, remote);
    remote.getLocalProperties().put(InterpreterContext.OUTPUT_PERSONALIZED_MODE, "false");
    remote.setAuthenticationInfo(new AuthenticationInfo("bob").toJson());
    InterpreterContext bob = (InterpreterContext) convert.invoke(server, remote);
    try (InterpreterOutput aliceOutput = alice.out(); InterpreterOutput bobOutput = bob.out()) {
      aliceOutput.write("private delayed output\n");
      aliceOutput.flush();
      aliceOutput.clear();
      bobOutput.write("shared output\n");
      bobOutput.flush();
      verify(client).onInterpreterOutputAppend(
          "note", "para", 0, "private delayed output\n", "alice", true);
      verify(client, atLeastOnce()).onInterpreterOutputUpdate(eq("note"), eq("para"), eq(0),
          eq(InterpreterResult.Type.TEXT), anyString(), eq("alice"), eq(true));
      verify(client).onInterpreterOutputUpdateAll("note", "para", List.of(), "alice", true);
      verify(client).onInterpreterOutputAppend(
          "note", "para", 0, "shared output\n", "bob", false);
    }
  }

  private InterpreterContext context(InterpreterOutput out) {
    return InterpreterContext.builder().setNoteId("note").setParagraphId("para")
        .setInterpreterOut(out).build();
  }

  private static class TestDevServer extends ZeppelinDevServer {
    final RemoteInterpreterEventClient client = mock(RemoteInterpreterEventClient.class);
    int refreshCount;

    TestDevServer() throws Exception {
      super(0);
    }

    @Override
    protected RemoteInterpreterEventClient getIntpEventClient() {
      return client;
    }

    @Override
    public void refresh() {
      refreshCount++;
    }
  }

  private static class TestApplicationServer extends ZeppelinApplicationDevServer {
    final RemoteInterpreterEventClient client = mock(RemoteInterpreterEventClient.class);

    TestApplicationServer() throws Exception {
      super(0, TestApplication.class.getName(), new ResourceSet());
    }

    @Override
    protected RemoteInterpreterEventClient getIntpEventClient() {
      return client;
    }

    @Override
    void setLogger() {
    }
  }

  public static class TestApplication extends Application {
    static final List<TestApplication> instances = new ArrayList<>();
    int runs;
    int unloads;

    public TestApplication(ApplicationContext context) {
      super(context);
      instances.add(this);
    }

    @Override
    public void run(ResourceSet resources) throws IOException {
      runs++;
      println("application output");
    }

    @Override
    public void unload() {
      unloads++;
    }
  }
}
