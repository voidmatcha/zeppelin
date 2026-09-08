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

package org.apache.zeppelin.notebook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.interpreter.InterpreterResult.Type;
import org.apache.zeppelin.interpreter.InterpreterResultMessage;
import org.junit.jupiter.api.Test;

class ParagraphOutputBufferTest {
  @Test
  void executionOutputModeFollowsTheSelectedParagraphAcrossModeChanges() throws Exception {
    Note note = new Note();
    Paragraph master = new Paragraph("para", note, null);
    note.getParagraphs().add(master);
    note.setPersonalizedMode(true);
    Paragraph alice = master.getUserParagraph("alice");
    Paragraph bob = master.cloneParagraphForUser("bob");
    note.setPersonalizedMode(false);

    assertEquals("true", executionOutputMode(alice));
    assertEquals("true", executionOutputMode(bob));
    assertEquals("false", executionOutputMode(master));
    note.setPersonalizedMode(true);
    assertEquals("false", executionOutputMode(master));
  }

  private String executionOutputMode(Paragraph paragraph) throws Exception {
    java.lang.reflect.Method method = Paragraph.class.getDeclaredMethod("getInterpreterContext");
    method.setAccessible(true);
    org.apache.zeppelin.interpreter.InterpreterContext context =
        (org.apache.zeppelin.interpreter.InterpreterContext) method.invoke(paragraph);
    return context.getLocalProperties().get(
        org.apache.zeppelin.interpreter.InterpreterContext.OUTPUT_PERSONALIZED_MODE);
  }

  @Test
  void clearedSnapshotRetainsTypesWithoutExposingOutputData() {
    Note note = new Note();
    Paragraph paragraph = new Paragraph("para", note, null);
    note.getParagraphs().add(paragraph);
    paragraph.updateOutputBuffer(0, Type.TABLE, "private data");
    note.clearParagraphOutputFields(paragraph, true);
    com.google.gson.Gson gson = new com.google.gson.Gson();
    com.google.gson.JsonObject snapshot = gson.toJsonTree(paragraph).getAsJsonObject();
    assertEquals("TABLE", snapshot.getAsJsonArray("outputTypes").get(0).getAsString());
    assertFalse(snapshot.has("results"));
    assertFalse(snapshot.has("outputBuffer"));
    assertFalse(snapshot.toString().contains("private data"));
    paragraph.updateOutputBuffer(0, Type.HTML, "replacement");
    assertEquals("HTML", gson.toJsonTree(paragraph).getAsJsonObject()
        .getAsJsonArray("outputTypes").get(0).getAsString());
    paragraph.cleanOutputBuffer();
    assertFalse(gson.toJsonTree(paragraph).getAsJsonObject().has("outputTypes"));
  }

  @Test
  void publishedCheckpointDoesNotChangeWhenTheBufferChanges() {
    Paragraph paragraph = new Paragraph("para", null, null);
    paragraph.updateOutputBuffer(0, Type.TEXT, "first");
    paragraph.updateOutputBuffer(1, Type.TABLE, "name\n");
    paragraph.checkpointOutput();
    InterpreterResult checkpoint = paragraph.getReturn();

    paragraph.appendOutputBuffer(0, " appended");
    paragraph.updateOutputBuffer(1, Type.HTML, "replacement");
    paragraph.cleanOutputBuffer();
    paragraph.updateOutputBuffer(0, Type.TEXT, "next");
    paragraph.checkpointOutput();

    assertEquals("first", checkpoint.message().get(0).getData());
    assertEquals(Type.TABLE, checkpoint.message().get(1).getType());
    assertEquals("name\n", checkpoint.message().get(1).getData());
    assertEquals("next", paragraph.getReturn().message().get(0).getData());
  }

  @Test
  void checkpointPublishesOnlyAfterCopyingAndExcludesConcurrentBufferMutation() throws Exception {
    Paragraph paragraph = new Paragraph("para", null, null);
    paragraph.updateOutputBuffer(0, Type.TEXT, "previous");
    paragraph.checkpointOutput();
    InterpreterResult previous = paragraph.getReturn();
    CountDownLatch copying = new CountDownLatch(1);
    CountDownLatch releaseCopy = new CountDownLatch(1);
    CountDownLatch mutationRequested = new CountDownLatch(1);
    List<InterpreterResultMessage> buffer = new PausingBuffer(copying, releaseCopy);
    buffer.add(new InterpreterResultMessage(Type.TEXT, "captured"));
    Field field = Paragraph.class.getDeclaredField("outputBuffer");
    field.setAccessible(true);
    field.set(paragraph, buffer);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<?> checkpoint = executor.submit(paragraph::checkpointOutput);
      assertTrue(copying.await(5, TimeUnit.SECONDS));
      assertSame(previous, paragraph.getReturn());
      Future<?> mutation = executor.submit(() -> {
        mutationRequested.countDown();
        paragraph.cleanOutputBuffer();
        paragraph.updateOutputBuffer(0, Type.TEXT, "after");
        paragraph.appendOutputBuffer(0, " append");
      });
      assertTrue(mutationRequested.await(5, TimeUnit.SECONDS));
      assertThrows(TimeoutException.class, () -> mutation.get(100, TimeUnit.MILLISECONDS));
      releaseCopy.countDown();
      checkpoint.get(5, TimeUnit.SECONDS);
      mutation.get(5, TimeUnit.SECONDS);
      assertEquals("captured", paragraph.getReturn().message().get(0).getData());
      paragraph.checkpointOutput();
      assertEquals("after append", paragraph.getReturn().message().get(0).getData());
    } finally {
      releaseCopy.countDown();
      executor.shutdownNow();
    }
  }

  private static class PausingBuffer extends ArrayList<InterpreterResultMessage> {
    private final CountDownLatch copying;
    private final CountDownLatch releaseCopy;

    PausingBuffer(CountDownLatch copying, CountDownLatch releaseCopy) {
      this.copying = copying;
      this.releaseCopy = releaseCopy;
    }

    @Override
    public Iterator<InterpreterResultMessage> iterator() {
      copying.countDown();
      try {
        assertTrue(releaseCopy.await(5, TimeUnit.SECONDS));
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError(e);
      }
      return super.iterator();
    }
  }
}
