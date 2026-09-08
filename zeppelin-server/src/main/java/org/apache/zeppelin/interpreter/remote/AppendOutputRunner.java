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
import org.apache.zeppelin.interpreter.InterpreterResultMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * Sends paragraph output periodically. Adjacent append events are batched, while update events
 * and full-output replacements share the same queue so that they cannot overtake earlier appends.
 */
public class AppendOutputRunner implements Runnable {

  private static final Logger LOGGER = LoggerFactory.getLogger(AppendOutputRunner.class);
  public static final Long BUFFER_TIME_MS = Long.valueOf(100);
  private static final Long SAFE_PROCESSING_TIME = Long.valueOf(10);
  private static final Long SAFE_PROCESSING_STRING_SIZE = Long.valueOf(100000);

  private final BlockingQueue<AppendOutputBuffer> queue = new LinkedBlockingQueue<>();
  private final RemoteInterpreterProcessListener listener;

  public AppendOutputRunner(RemoteInterpreterProcessListener listener) {
    this.listener = listener;
  }

  @Override
  public synchronized void run() {

    Map<List<String>, StringBuilder> stringBufferMap = new LinkedHashMap<>();
    List<AppendOutputBuffer> list = new LinkedList<>();

    queue.drainTo(list);
    if (list.isEmpty()) {
      return;
    }
    Long processingStartTime = System.currentTimeMillis();

    Long sizeProcessed = Long.valueOf(0);
    for (AppendOutputBuffer buffer : list) {
      try {
        if (buffer instanceof UpdateAllOutputBuffer) {
          sizeProcessed += flushAppendBuffers(stringBufferMap);
          UpdateAllOutputBuffer update = (UpdateAllOutputBuffer) buffer;
          if (update.getPersonalized() != null) {
            listener.onOutputClearForUser(update.getNoteId(), update.getParagraphId(),
                update.getUser(), update.getPersonalized());
          } else if (update.getUser() == null) {
            listener.onOutputClear(update.getNoteId(), update.getParagraphId());
          } else {
            listener.onOutputClearForUser(update.getNoteId(), update.getParagraphId(),
                update.getUser());
          }
          for (int i = 0; i < update.getMessages().size(); i++) {
            InterpreterResultMessage message = update.getMessages().get(i);
            deliverUpdate(update, i, message.getType(), message.getData());
          }
          continue;
        }
        if (buffer instanceof UpdateOutputBuffer) {
          sizeProcessed += flushAppendBuffers(stringBufferMap);
          UpdateOutputBuffer update = (UpdateOutputBuffer) buffer;
          deliverUpdate(update, update.getIndex(), update.getType(), update.getData());
          continue;
        }

        String noteId = buffer.getNoteId();
        String paragraphId = buffer.getParagraphId();
        int index = buffer.getIndex();
        List<String> stringBufferKey = Arrays.asList(noteId, paragraphId,
            Integer.toString(index), buffer.getUser(),
            buffer.getPersonalized() == null ? null : buffer.getPersonalized().toString());

        StringBuilder builder = stringBufferMap.containsKey(stringBufferKey) ?
            stringBufferMap.get(stringBufferKey) : new StringBuilder();

        builder.append(buffer.getData());
        stringBufferMap.put(stringBufferKey, builder);
      } catch (RuntimeException e) {
        // A removed paragraph or broken listener must not stop the shared scheduled drain.
        LOGGER.warn("Failed to deliver output for note {} paragraph {}",
            buffer.getNoteId(), buffer.getParagraphId(), e);
      }
    }
    sizeProcessed += flushAppendBuffers(stringBufferMap);
    Long processingTime = System.currentTimeMillis() - processingStartTime;

    if (processingTime > SAFE_PROCESSING_TIME) {
      LOGGER.warn("Processing time for buffered append-output is high: {} milliseconds.", processingTime);
    } else {
      LOGGER.debug("Processing time for append-output took {} milliseconds", processingTime);
    }

    if (sizeProcessed > SAFE_PROCESSING_STRING_SIZE) {
      LOGGER.warn("Processing size for buffered append-output is high: {} characters.", sizeProcessed);
    } else {
      LOGGER.debug("Processing size for append-output is {} characters", sizeProcessed);
    }
  }

  private long flushAppendBuffers(Map<List<String>, StringBuilder> stringBufferMap) {
    long sizeProcessed = 0;
    for (Entry<List<String>, StringBuilder> stringBufferMapEntry : stringBufferMap.entrySet()) {
      List<String> keys = stringBufferMapEntry.getKey();
      StringBuilder buffer = stringBufferMapEntry.getValue();
      sizeProcessed += buffer.length();
      try {
        if (keys.get(4) != null) {
          listener.onOutputAppendForUser(keys.get(0), keys.get(1), Integer.parseInt(keys.get(2)),
              buffer.toString(), keys.get(3), Boolean.valueOf(keys.get(4)));
        } else if (keys.get(3) == null) {
          listener.onOutputAppend(keys.get(0), keys.get(1), Integer.parseInt(keys.get(2)),
              buffer.toString());
        } else {
          listener.onOutputAppendForUser(keys.get(0), keys.get(1), Integer.parseInt(keys.get(2)),
              buffer.toString(), keys.get(3));
        }
      } catch (RuntimeException e) {
        LOGGER.warn("Failed to append output for note {} paragraph {}",
            keys.get(0), keys.get(1), e);
      }
    }
    stringBufferMap.clear();
    return sizeProcessed;
  }

  private void deliverUpdate(AppendOutputBuffer buffer, int index,
                             InterpreterResult.Type type, String data) {
    if (buffer.getPersonalized() != null) {
      listener.onOutputUpdatedForUser(buffer.getNoteId(), buffer.getParagraphId(), index,
          type, data, buffer.getUser(), buffer.getPersonalized());
    } else if (buffer.getUser() == null) {
      listener.onOutputUpdated(buffer.getNoteId(), buffer.getParagraphId(), index, type, data);
    } else {
      listener.onOutputUpdatedForUser(buffer.getNoteId(), buffer.getParagraphId(), index,
          type, data, buffer.getUser());
    }
  }

  public void appendBuffer(String noteId, String paragraphId, int index, String output) {
    appendBuffer(noteId, paragraphId, index, output, null);
  }

  public void appendBuffer(String noteId, String paragraphId, int index,
                           String output, String user) {
    appendBuffer(noteId, paragraphId, index, output, user, null);
  }

  public void appendBuffer(String noteId, String paragraphId, int index,
                           String output, String user, Boolean personalized) {
    queue.offer(new AppendOutputBuffer(noteId, paragraphId, index, output, user, personalized));
  }

  public void updateBuffer(String noteId, String paragraphId, int index,
                           InterpreterResult.Type type, String output) {
    updateBuffer(noteId, paragraphId, index, type, output, null);
  }

  public void updateBuffer(String noteId, String paragraphId, int index,
                           InterpreterResult.Type type, String output, String user) {
    updateBuffer(noteId, paragraphId, index, type, output, user, null);
  }

  public void updateBuffer(String noteId, String paragraphId, int index,
                           InterpreterResult.Type type, String output, String user,
                           Boolean personalized) {
    queue.offer(new UpdateOutputBuffer(noteId, paragraphId, index, type, output, user,
        personalized));
  }

  @FunctionalInterface
  public interface OutputOperation {
    void run() throws IOException;
  }

  /** Execute a user output mutation after queued output, without an intervening drain. */
  public synchronized void runAfterOutput(OutputOperation operation) throws IOException {
    run();
    operation.run();
  }

  public void checkpointOutput(String noteId, String paragraphId) {
    checkpointOutput(noteId, paragraphId, null);
  }

  public void checkpointOutput(String noteId, String paragraphId, String user) {
    checkpointOutput(noteId, paragraphId, user, null);
  }

  public void checkpointOutput(String noteId, String paragraphId, String user,
                               Boolean personalized) {
    Runnable persist;
    synchronized (this) {
      run();
      persist = personalized == null
          ? listener.prepareCheckpointOutput(noteId, paragraphId, user)
          : listener.prepareCheckpointOutput(noteId, paragraphId, user, personalized);
    }
    if (persist != null) {
      persist.run();
    }
  }

  public void updateAllBuffer(String noteId, String paragraphId,
                              List<InterpreterResultMessage> messages) {
    updateAllBuffer(noteId, paragraphId, messages, null);
  }

  public synchronized void updateAllBuffer(String noteId, String paragraphId,
                              List<InterpreterResultMessage> messages, String user) {
    updateAllBuffer(noteId, paragraphId, messages, user, null);
  }

  public synchronized void updateAllBuffer(String noteId, String paragraphId,
                              List<InterpreterResultMessage> messages, String user,
                              Boolean personalized) {
    queue.offer(new UpdateAllOutputBuffer(noteId, paragraphId, messages, user, personalized));
    run();
  }
}
