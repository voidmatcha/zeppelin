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

import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.log4j.AppenderSkeleton;
import org.apache.log4j.Level;
import org.apache.log4j.Logger;
import org.apache.log4j.spi.LoggingEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.mockito.invocation.InvocationOnMock;
import org.mockito.stubbing.Answer;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.atMost;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class AppendOutputRunnerTest {

  private static final int NUM_EVENTS = 10000;
  private static final int NUM_CLUBBED_EVENTS = 100;
  private static final ScheduledExecutorService service = Executors.newSingleThreadScheduledExecutor();
  private static ScheduledFuture<?> future = null;
  /* It is being accessed by multiple threads.
   * While loop for 'loopForBufferCompletion' could
   * run for-ever.
   */
  private volatile static int numInvocations = 0;

  @AfterEach
  public void afterEach() {
    if (future != null) {
      future.cancel(true);
    }
  }

  @Test
  void batchesKeepExecutionUsersSeparateIncludingDelimiterCharacters() {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    runner.appendBuffer("note", "para", 0, "a1", "alice:team");
    runner.appendBuffer("note", "para", 0, "b1", "bob");
    runner.appendBuffer("note", "para", 0, "a2", "alice:team");
    runner.updateBuffer("note", "para", 0, InterpreterResult.Type.TEXT, "b2", "bob");
    runner.updateAllBuffer("note", "para", Collections.emptyList(), "alice:team");

    InOrder order = inOrder(listener);
    order.verify(listener).onOutputAppendForUser("note", "para", 0, "a1a2", "alice:team");
    order.verify(listener).onOutputAppendForUser("note", "para", 0, "b1", "bob");
    order.verify(listener).onOutputUpdatedForUser(
        "note", "para", 0, InterpreterResult.Type.TEXT, "b2", "bob");
    order.verify(listener).onOutputClearForUser("note", "para", "alice:team");
    order.verifyNoMoreInteractions();
  }

  @Test
  void outputMutationCannotBeOvertakenByAnotherDrain() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    CountDownLatch clearing = new CountDownLatch(1);
    CountDownLatch releaseClear = new CountDownLatch(1);
    CountDownLatch nextDrainStarted = new CountDownLatch(1);
    java.util.concurrent.ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      java.util.concurrent.Future<?> clear = executor.submit(() -> {
        runner.runAfterOutput(() -> {
          clearing.countDown();
          try {
            assertTrue(releaseClear.await(5, TimeUnit.SECONDS));
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException(e);
          }
        });
        return null;
      });
      assertTrue(clearing.await(5, TimeUnit.SECONDS));
      runner.appendBuffer("note", "para", 0, "after clear");
      java.util.concurrent.Future<?> drain = executor.submit(() -> {
        nextDrainStarted.countDown();
        runner.run();
      });
      assertTrue(nextDrainStarted.await(5, TimeUnit.SECONDS));
      assertThrows(java.util.concurrent.TimeoutException.class,
          () -> drain.get(100, TimeUnit.MILLISECONDS));
      org.mockito.Mockito.verifyNoInteractions(listener);
      releaseClear.countDown();
      clear.get(5, TimeUnit.SECONDS);
      drain.get(5, TimeUnit.SECONDS);
      verify(listener).onOutputAppend("note", "para", 0, "after clear");
    } finally {
      releaseClear.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void failedOutputMutationPropagatesAndDoesNotStopLaterOutput() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    IOException failure = new IOException("clear failed");
    assertEquals(failure, assertThrows(IOException.class,
        () -> runner.runAfterOutput(() -> { throw failure; })));
    runner.appendBuffer("note", "para", 0, "still flowing");
    runner.run();
    verify(listener).onOutputAppend("note", "para", 0, "still flowing");
  }

  @Test
  void slowCheckpointPersistenceDoesNotBlockAnotherParagraphDrain() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    CountDownLatch saving = new CountDownLatch(1);
    CountDownLatch releaseSave = new CountDownLatch(1);
    org.mockito.Mockito.when(listener.prepareCheckpointOutput("note", "slow", null))
        .thenReturn(() -> {
          saving.countDown();
          try {
            assertTrue(releaseSave.await(5, TimeUnit.SECONDS));
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
          }
        });
    java.util.concurrent.ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      java.util.concurrent.Future<?> checkpoint = executor.submit(
          () -> runner.checkpointOutput("note", "slow"));
      assertTrue(saving.await(5, TimeUnit.SECONDS));
      runner.updateBuffer("other-note", "healthy", 0, InterpreterResult.Type.TEXT, "new");
      executor.submit(runner).get(2, TimeUnit.SECONDS);
      verify(listener).onOutputUpdated(
          "other-note", "healthy", 0, InterpreterResult.Type.TEXT, "new");
      assertFalse(checkpoint.isDone());
      releaseSave.countDown();
      checkpoint.get(5, TimeUnit.SECONDS);
    } finally {
      releaseSave.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void scheduledDrainSurvivesFailedUpdate() throws Exception {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    CountDownLatch firstDelivered = new CountDownLatch(1);
    CountDownLatch nextDelivered = new CountDownLatch(1);
    doThrow(new NullPointerException("removed paragraph")).when(listener)
        .onOutputUpdated("note", "removed", 0, InterpreterResult.Type.TEXT, "bad");
    doAnswer(invocation -> {
      firstDelivered.countDown();
      return null;
    }).when(listener).onOutputAppend("note", "healthy", 0, "first");
    doAnswer(invocation -> {
      nextDelivered.countDown();
      return null;
    }).when(listener).onOutputAppend("note", "healthy", 0, "next");
    runner.updateBuffer("note", "removed", 0, InterpreterResult.Type.TEXT, "bad");
    runner.appendBuffer("note", "healthy", 0, "first");
    ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    ScheduledFuture<?> scheduled = executor.scheduleWithFixedDelay(
        runner, 0, 10, TimeUnit.MILLISECONDS);
    try {
      assertTrue(firstDelivered.await(5, TimeUnit.SECONDS));
      // Enqueued after the first batch was drained, requiring another scheduled execution.
      runner.appendBuffer("note", "healthy", 0, "next");
      assertTrue(nextDelivered.await(5, TimeUnit.SECONDS));
      assertFalse(scheduled.isDone());
    } finally {
      scheduled.cancel(true);
      executor.shutdownNow();
    }
  }

  @Test
  void failedAppendDoesNotDiscardOtherParagraphsOrUpdates() {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    doThrow(new IllegalStateException("failed append")).when(listener)
        .onOutputAppend("note", "bad", 0, "bad");
    runner.appendBuffer("note", "bad", 0, "bad");
    runner.appendBuffer("note", "healthy", 0, "good");
    runner.updateBuffer("note", "healthy", 0, InterpreterResult.Type.TEXT, "replacement");

    runner.run();

    InOrder order = inOrder(listener);
    order.verify(listener).onOutputAppend("note", "healthy", 0, "good");
    order.verify(listener).onOutputUpdated(
        "note", "healthy", 0, InterpreterResult.Type.TEXT, "replacement");
  }

  @Test
  void failedClearDoesNotDiscardLaterEvents() {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    doThrow(new IllegalStateException("failed clear")).when(listener)
        .onOutputClear("note", "bad");
    runner.updateAllBuffer("note", "bad", Collections.emptyList());
    runner.updateBuffer("note", "healthy", 0, InterpreterResult.Type.TEXT, "good");

    runner.run();

    verify(listener).onOutputUpdated("note", "healthy", 0, InterpreterResult.Type.TEXT, "good");
  }

  @Test
  void testSingleEvent() throws InterruptedException {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    String[][] buffer = {{"note", "para", "data\n"}};

    loopForCompletingEvents(listener, 1, buffer);
    verify(listener, times(1)).onOutputAppend(any(String.class), any(String.class), anyInt(), any(String.class));
    verify(listener, times(1)).onOutputAppend("note", "para", 0, "data\n");
  }

  @Test
  public void testMultipleEventsOfSameParagraph() throws InterruptedException {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    String note1 = "note1";
    String para1 = "para1";
    String[][] buffer = {
        {note1, para1, "data1\n"},
        {note1, para1, "data2\n"},
        {note1, para1, "data3\n"}
    };

    loopForCompletingEvents(listener, 1, buffer);
    verify(listener, times(1)).onOutputAppend(any(String.class), any(String.class), anyInt(), any(String.class));
    verify(listener, times(1)).onOutputAppend(note1, para1, 0, "data1\ndata2\ndata3\n");
  }

  @Test
  void testUpdateDoesNotOvertakeQueuedAppend() {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    runner.appendBuffer("note", "para", 0, "before-1\n");
    runner.appendBuffer("note", "para", 0, "before-2\n");
    runner.updateBuffer("note", "para", 0, InterpreterResult.Type.TEXT, "replacement\n");
    runner.appendBuffer("note", "para", 0, "after\n");

    runner.run();

    InOrder order = inOrder(listener);
    order.verify(listener).onOutputAppend("note", "para", 0, "before-1\nbefore-2\n");
    order.verify(listener).onOutputUpdated(
        "note", "para", 0, InterpreterResult.Type.TEXT, "replacement\n");
    order.verify(listener).onOutputAppend("note", "para", 0, "after\n");
  }

  @Test
  void testMultipleEventsOfDifferentParagraphs() throws InterruptedException {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    String note1 = "note1";
    String note2 = "note2";
    String para1 = "para1";
    String para2 = "para2";
    String[][] buffer = {
        {note1, para1, "data1\n"},
        {note1, para2, "data2\n"},
        {note2, para1, "data3\n"},
        {note2, para2, "data4\n"}
    };
    loopForCompletingEvents(listener, 4, buffer);

    verify(listener, times(4)).onOutputAppend(any(String.class), any(String.class), anyInt(), any(String.class));
    verify(listener, times(1)).onOutputAppend(note1, para1, 0, "data1\n");
    verify(listener, times(1)).onOutputAppend(note1, para2, 0, "data2\n");
    verify(listener, times(1)).onOutputAppend(note2, para1, 0, "data3\n");
    verify(listener, times(1)).onOutputAppend(note2, para2, 0, "data4\n");
  }

  @Test
  void testClubbedData() throws InterruptedException {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    future = service.scheduleWithFixedDelay(runner, 0,
        AppendOutputRunner.BUFFER_TIME_MS, TimeUnit.MILLISECONDS);
    Thread thread = new Thread(new BombardEvents(runner));
    thread.start();
    thread.join();
    Thread.sleep(1000);

    /* NUM_CLUBBED_EVENTS is a heuristic number.
     * It has been observed that for 10,000 continuos event
     * calls, 30-40 Web-socket calls are made. Keeping
     * the unit-test to a pessimistic 100 web-socket calls.
     */
    verify(listener, atMost(NUM_CLUBBED_EVENTS)).onOutputAppend(any(String.class), any(String.class), anyInt(), any(String.class));
  }

  @Test
  void testWarnLoggerForLargeData() throws InterruptedException {
    RemoteInterpreterProcessListener listener = mock(RemoteInterpreterProcessListener.class);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    String data = "data\n";
    int numEvents = 100000;

    for (int i=0; i<numEvents; i++) {
      runner.appendBuffer("noteId", "paraId", 0, data);
    }

    TestAppender appender = new TestAppender();
    Logger logger = Logger.getRootLogger();
    logger.addAppender(appender);

    runner.run();
    List<LoggingEvent> log;

    int warnLogCounter;
    LoggingEvent sizeWarnLogEntry = null;
    do {
      warnLogCounter = 0;
      log = appender.getLog();
      for (LoggingEvent logEntry: log) {
        if (Level.WARN.equals(logEntry.getLevel())) {
          sizeWarnLogEntry = logEntry;
          warnLogCounter += 1;
        }
      }
    } while(warnLogCounter != 2);

    String loggerString = "Processing size for buffered append-output is high: " +
        (data.length() * numEvents) + " characters.";
    assertEquals(loggerString, sizeWarnLogEntry.getMessage());
  }

  private class BombardEvents implements Runnable {

    private final AppendOutputRunner runner;

    private BombardEvents(AppendOutputRunner runner) {
      this.runner = runner;
    }

    @Override
    public void run() {
      String noteId = "noteId";
      String paraId = "paraId";
      for (int i=0; i<NUM_EVENTS; i++) {
        runner.appendBuffer(noteId, paraId, 0, "data\n");
      }
    }
  }

  private class TestAppender extends AppenderSkeleton {
    private final List<LoggingEvent> log = new ArrayList<>();

    @Override
    public boolean requiresLayout() {
        return false;
    }

    @Override
    protected void append(final LoggingEvent loggingEvent) {
        log.add(loggingEvent);
    }

    @Override
    public void close() {
    }

    public List<LoggingEvent> getLog() {
        return new ArrayList<>(log);
    }
  }

  private void prepareInvocationCounts(RemoteInterpreterProcessListener listener) {
    doAnswer(new Answer<Void>() {
      @Override
      public Void answer(InvocationOnMock invocation) throws Throwable {
        numInvocations += 1;
        return null;
      }
    }).when(listener).onOutputAppend(any(String.class), any(String.class), anyInt(), any(String.class));
  }

  private void loopForCompletingEvents(RemoteInterpreterProcessListener listener,
      int numTimes, String[][] buffer) {
    numInvocations = 0;
    prepareInvocationCounts(listener);
    AppendOutputRunner runner = new AppendOutputRunner(listener);
    for (String[] bufferElement: buffer) {
      runner.appendBuffer(bufferElement[0], bufferElement[1], 0, bufferElement[2]);
    }
    future = service.scheduleWithFixedDelay(runner, 0,
        AppendOutputRunner.BUFFER_TIME_MS, TimeUnit.MILLISECONDS);
    long startTimeMs = System.currentTimeMillis();
    while(numInvocations != numTimes) {
      if (System.currentTimeMillis() - startTimeMs > 2000) {
        fail("Buffered events were not sent for 2 seconds");
      }
    }
  }
}