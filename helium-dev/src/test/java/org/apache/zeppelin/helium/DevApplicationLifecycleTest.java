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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.apache.zeppelin.interpreter.InterpreterContext;
import org.apache.zeppelin.interpreter.InterpreterOutput;
import org.apache.zeppelin.interpreter.InterpreterOutputListener;
import org.apache.zeppelin.interpreter.InterpreterResult.Code;
import org.apache.zeppelin.interpreter.InterpreterResultMessageOutput;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterEventClient;
import org.apache.zeppelin.resource.ResourceSet;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DevApplicationLifecycleTest {
  @TempDir
  Path directory;

  @BeforeEach
  void resetApplication() {
    WatchingApplication.instances.clear();
    WatchingApplication.nextFile = null;
    WatchingApplication.unloadFailure = null;
  }

  @Test
  void replacementAndSameContextRerunStopOldWatchersAndWatchNewResources() throws Exception {
    WatchingServer server = new WatchingServer();
    Path aliceFile = Files.writeString(directory.resolve("alice.html"), "alice initial");
    Path bobFile = Files.writeString(directory.resolve("bob.html"), "bob initial");
    try (InterpreterOutput alice = server.createInterpreterOutput("note", "para", "alice");
         InterpreterOutput bob = server.createInterpreterOutput("note", "para", "bob")) {
      WatchingApplication.nextFile = aliceFile.toFile();
      assertEquals(Code.SUCCESS, server.interpret("", context(alice)).code());
      Thread aliceWatcher = watcher(alice);
      Files.writeString(aliceFile, "alice changed");
      awaitFileChange(server, aliceFile);

      WatchingApplication.nextFile = bobFile.toFile();
      InterpreterContext bobContext = context(bob);
      assertEquals(Code.SUCCESS, server.interpret("", bobContext).code());
      assertStopped(aliceWatcher);
      Thread firstBobWatcher = watcher(bob);
      server.changes.clear();
      Files.writeString(aliceFile, "alice must no longer trigger a refresh");
      Files.writeString(bobFile, "bob changed");
      awaitFileChange(server, bobFile);

      WatchingApplication bobApp = WatchingApplication.instances.get(1);
      assertEquals(Code.SUCCESS, server.interpret("", bobContext).code());
      assertStopped(firstBobWatcher);
      assertEquals(2, WatchingApplication.instances.size());
      assertSame(bobApp, WatchingApplication.instances.get(1));
      assertEquals(2, bobApp.runs);
      assertNotSame(firstBobWatcher, watcher(bob));
      server.changes.clear();
      Files.writeString(bobFile, "bob rerun changed");
      awaitFileChange(server, bobFile);
    }
  }

  @Test
  void unloadFailureClosesItsRealWatcherAndTheNextExecutionRecovers() throws Exception {
    WatchingServer server = new WatchingServer();
    Path aliceFile = Files.writeString(directory.resolve("failing-alice.html"), "alice initial");
    Path bobFile = Files.writeString(directory.resolve("recovered-bob.html"), "bob initial");
    try (InterpreterOutput alice = server.createInterpreterOutput("note", "para", "alice");
         InterpreterOutput bob = server.createInterpreterOutput("note", "para", "bob")) {
      WatchingApplication.nextFile = aliceFile.toFile();
      assertEquals(Code.SUCCESS, server.interpret("", context(alice)).code());
      Thread oldWatcher = watcher(alice);
      WatchingApplication.unloadFailure = new ApplicationException("unload failed");
      WatchingApplication.nextFile = bobFile.toFile();
      assertEquals(Code.ERROR, server.interpret("", context(bob)).code());
      assertStopped(oldWatcher);
      // Even a consistently failing old unload must not poison every subsequent execution.
      assertEquals(Code.SUCCESS, server.interpret("", context(bob)).code());
      assertEquals(2, WatchingApplication.instances.size());
      assertEquals(1, WatchingApplication.instances.get(0).unloads);
      Files.writeString(bobFile, "recovered watcher changed");
      awaitFileChange(server, bobFile);
    }
  }

  @Test
  void closeFailureIsSuppressedBehindUnloadFailureAndDoesNotPreventRecovery() throws Exception {
    WatchingServer server = new WatchingServer();
    FailingCloseOutput alice = new FailingCloseOutput();
    try (InterpreterOutput bob = server.createInterpreterOutput("note", "para", "bob")) {
      assertEquals(Code.SUCCESS, server.interpret("", context(alice)).code());
      ApplicationException failure = new ApplicationException("original unload failure");
      WatchingApplication.unloadFailure = failure;
      assertEquals(Code.ERROR, server.interpret("", context(bob)).code());
      assertTrue(alice.closed);
      assertEquals(1, failure.getSuppressed().length);
      assertSame(alice.closeFailure, failure.getSuppressed()[0]);
      assertEquals(Code.SUCCESS, server.interpret("", context(bob)).code());
    }
  }

  private InterpreterContext context(InterpreterOutput out) {
    return InterpreterContext.builder().setNoteId("note").setParagraphId("para")
        .setInterpreterOut(out).build();
  }

  private Thread watcher(InterpreterOutput out) throws Exception {
    Field field = InterpreterResultMessageOutput.class.getDeclaredField("watcher");
    field.setAccessible(true);
    return (Thread) field.get(out.getOutputAt(0));
  }

  private void assertStopped(Thread watcher) throws InterruptedException {
    watcher.join(5000);
    assertFalse(watcher.isAlive(), "The previous output's watcher must terminate");
  }

  private void awaitFileChange(WatchingServer server, Path expected) throws InterruptedException {
    // macOS WatchService may poll rather than deliver native events immediately.
    Path changed = server.changes.poll(15, TimeUnit.SECONDS);
    assertEquals(expected.toAbsolutePath().normalize(), changed);
  }

  private static class WatchingServer extends ZeppelinApplicationDevServer {
    final RemoteInterpreterEventClient client = mock(RemoteInterpreterEventClient.class);
    final BlockingQueue<Path> changes = new LinkedBlockingQueue<>();

    WatchingServer() throws Exception {
      super(0, WatchingApplication.class.getName(), new ResourceSet());
    }

    @Override
    protected RemoteInterpreterEventClient getIntpEventClient() {
      return client;
    }

    @Override
    public void fileChanged(File file) {
      changes.add(file.toPath().toAbsolutePath().normalize());
    }

    @Override
    void setLogger() {
    }
  }

  private static class FailingCloseOutput extends InterpreterOutput {
    final IOException closeFailure = new IOException("close failed");
    boolean closed;

    FailingCloseOutput() {
      super(mock(InterpreterOutputListener.class));
    }

    @Override
    public void close() throws IOException {
      super.close();
      closed = true;
      throw closeFailure;
    }
  }

  public static class WatchingApplication extends Application {
    static final List<WatchingApplication> instances = new ArrayList<>();
    static File nextFile;
    static ApplicationException unloadFailure;
    final File resourceFile;
    int runs;
    int unloads;

    public WatchingApplication(ApplicationContext context) {
      super(context);
      resourceFile = nextFile;
      instances.add(this);
    }

    @Override
    public void run(ResourceSet resources) throws IOException {
      runs++;
      if (resourceFile != null) {
        context().out.write(resourceFile);
      }
    }

    @Override
    public void unload() throws ApplicationException {
      unloads++;
      if (unloadFailure != null) {
        throw unloadFailure;
      }
    }
  }
}
