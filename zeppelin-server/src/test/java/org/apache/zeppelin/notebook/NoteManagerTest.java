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

import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.notebook.exception.NotePathAlreadyExistsException;
import org.apache.zeppelin.notebook.repo.InMemoryNotebookRepo;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NoteManagerTest {
  private NoteManager noteManager;
  private ZeppelinConfiguration zConf;
  private NoteParser noteParser;


  @BeforeEach
  public void setUp() throws IOException {
    zConf = ZeppelinConfiguration.load();
    this.noteManager = new NoteManager(new InMemoryNotebookRepo(), zConf);
    this.noteParser = new GsonNoteParser(zConf);
  }

  @Test
  void testNoteOperations() throws IOException {
    assertEquals(0, this.noteManager.getNotesInfo().size());

    Note note1 = createNote("/prod/my_note1");
    Note note2 = createNote("/dev/project_2/my_note2");
    Note note3 = createNote("/dev/project_3/my_note3");

    // add note
    this.noteManager.saveNote(note1);
    this.noteManager.saveNote(note2);
    this.noteManager.saveNote(note3);

    // list notes
    assertEquals(3, this.noteManager.getNotesInfo().size());
    assertEquals(note1, this.noteManager.processNote(note1.getId(), n -> n));
    assertEquals(note2, this.noteManager.processNote(note2.getId(), n -> n));
    assertEquals(note3, this.noteManager.processNote(note3.getId(), n -> n));

    // move note
    this.noteManager.moveNote(note1.getId(), "/dev/project_1/my_note1",
            AuthenticationInfo.ANONYMOUS);
    assertEquals(3, this.noteManager.getNotesInfo().size());
    assertEquals("/dev/project_1/my_note1",
            this.noteManager.processNote(note1.getId(), n -> n).getPath());

    // move folder
    this.noteManager.moveFolder("/dev", "/staging", AuthenticationInfo.ANONYMOUS);
    Map<String, String> notesInfo = this.noteManager.getNotesInfo();
    assertEquals(3, notesInfo.size());
    assertEquals("/staging/project_1/my_note1", notesInfo.get(note1.getId()));
    assertEquals("/staging/project_2/my_note2", notesInfo.get(note2.getId()));
    assertEquals("/staging/project_3/my_note3", notesInfo.get(note3.getId()));

    this.noteManager.removeNote(note1.getId(), AuthenticationInfo.ANONYMOUS);
    assertEquals(2, this.noteManager.getNotesInfo().size());

    // remove folder
    this.noteManager.removeFolder("/staging", AuthenticationInfo.ANONYMOUS);
    notesInfo = this.noteManager.getNotesInfo();
    assertEquals(0, notesInfo.size());
  }

  @Test
  void testAddNoteRejectsDuplicatePath() throws IOException {

    assertThrows(NotePathAlreadyExistsException.class,
            () -> {
              Note note1 = createNote("/prod/note");
              Note note2 = createNote("/prod/note");

              noteManager.addNote(note1, AuthenticationInfo.ANONYMOUS);
              noteManager.addNote(note2, AuthenticationInfo.ANONYMOUS);
            },
            "Note '/prod/note' existed");
  }

  @Test
  void testMoveNoteRejectsDuplicatePath() throws IOException {
    assertThrows(NotePathAlreadyExistsException.class,
            () -> {
              Note note1 = createNote("/prod/note-1");
              Note note2 = createNote("/prod/note-2");

              noteManager.addNote(note1, AuthenticationInfo.ANONYMOUS);
              noteManager.addNote(note2, AuthenticationInfo.ANONYMOUS);

              noteManager.moveNote(note2.getId(), "/prod/note-1", AuthenticationInfo.ANONYMOUS);
            },
            "Note '/prod/note-1' existed");
  }

  private Note createNote(String notePath) {
    return new Note(notePath, "test", null, null, null, null, null, zConf, noteParser);
  }

  @Test
  void asynchronousExecutionSurvivesEvictionAndExplicitReloadUntilCompletion() throws Exception {
    ZeppelinConfiguration smallCache = spy(zConf);
    doReturn(1).when(smallCache).getNoteCacheThreshold();
    Map<String, String> saved = new ConcurrentHashMap<>();
    InMemoryNotebookRepo repo = new InMemoryNotebookRepo() {
      @Override
      public void save(Note note, AuthenticationInfo subject) throws IOException {
        super.save(note, subject);
        // Repository loads must return a detached identity, as disk-backed repositories do.
        saved.put(note.getId(), new com.google.gson.Gson().toJson(note, Note.class));
      }

      @Override
      public Note get(String id, String path, AuthenticationInfo subject) throws IOException {
        return NoteManagerTest.this.noteParser.fromJson(id, saved.get(id));
      }
    };
    NoteManager manager = new NoteManager(repo, smallCache);
    Note active = spy(createNote("/active"));
    active.setPersonalizedMode(true);
    active.setParagraphJobListener(mock(ParagraphJobListener.class));
    manager.addNote(active, AuthenticationInfo.ANONYMOUS);
    manager.saveNote(active);
    Paragraph paragraph = spy(new Paragraph("async-paragraph", active, null));
    active.getParagraphs().add(paragraph);
    doReturn(null).when(paragraph).getBindedInterpreter();
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch finished = new CountDownLatch(1);
    doAnswer(invocation -> {
      started.countDown();
      assertTrue(release.await(5, TimeUnit.SECONDS));
      return true;
    }).when(active).run(anyString(), eq(true));
    doAnswer(invocation -> {
      invocation.callRealMethod();
      if (!active.hasActiveExecution()) {
        finished.countDown();
      }
      return null;
    }).when(active).endParagraphExecution();
    try {
      manager.processNote(active.getId(), n -> {
        try {
          n.runAll(AuthenticationInfo.ANONYMOUS, false, false, Collections.emptyMap());
        } catch (Exception e) {
          throw new IOException(e);
        }
        return null;
      });
      assertTrue(started.await(5, TimeUnit.SECONDS));
      Note pressure = createNote("/pressure");
      pressure.beginParagraphExecution();
      try {
        manager.addNote(pressure, AuthenticationInfo.ANONYMOUS);
        assertEquals(2, manager.getCacheSize(), "active executions may exceed the cache limit");
      } finally {
        pressure.endParagraphExecution();
      }
      assertSame(active, manager.processNote(active.getId(), n -> n));
      assertSame(active, manager.processNote(active.getId(), true, n -> {
        assertFalse(n.canChangePersonalizedMode());
        return n;
      }));
      manager.reloadNotes();
      assertSame(active, manager.processNote(active.getId(), true, n -> n));
      assertNull(manager.processNote("missing", true, n -> n));
    } finally {
      release.countDown();
    }
    assertTrue(finished.await(5, TimeUnit.SECONDS));
    Note reloaded = manager.processNote(active.getId(), true, n -> n);
    assertNotSame(active, reloaded);
    assertTrue(reloaded.canChangePersonalizedMode());
    // The cache grew while both notes were admitted. Each insertion evicts one LRU entry,
    // so replace every existing entry before asserting that the completed note was evicted.
    int cachedNotes = manager.getCacheSize();
    for (int i = 0; i < cachedNotes; i++) {
      manager.addNote(createNote("/after-completion-" + i), AuthenticationInfo.ANONYMOUS);
    }
    assertNotSame(reloaded, manager.processNote(active.getId(), n -> n));
  }

  @Test
  void explicitReloadDoesNotReplaceAParagraphAdmissionHeldByAnotherThread() throws Exception {
    Note active = createNote("/admitted");
    noteManager.addNote(active, AuthenticationInfo.ANONYMOUS);
    ExecutorService executor = Executors.newSingleThreadExecutor();
    try {
      active.beginParagraphExecution();
      assertSame(active, executor.submit(() ->
          noteManager.processNote(active.getId(), true, n -> n)).get(5, TimeUnit.SECONDS));
      assertFalse(active.canChangePersonalizedMode());
    } finally {
      active.endParagraphExecution();
      executor.shutdownNow();
    }
    assertTrue(active.canChangePersonalizedMode());
  }

  @Test
  void forcedReloadDefersWithoutBlockingWhileAnotherThreadProcessesTheNote() throws Exception {
    InMemoryNotebookRepo repo = spy(new InMemoryNotebookRepo());
    NoteManager manager = new NoteManager(repo, zConf);
    Note active = createNote("/processing");
    manager.addNote(active, AuthenticationInfo.ANONYMOUS);
    manager.saveNote(active);
    ExecutorService executor = Executors.newSingleThreadExecutor();
    active.getLock().readLock().lock();
    try {
      assertSame(active, executor.submit(() ->
          manager.processNote(active.getId(), true, n -> n)).get(5, TimeUnit.SECONDS));
      verify(repo, never()).get(anyString(), anyString(), any());
    } finally {
      active.getLock().readLock().unlock();
      executor.shutdownNow();
    }
    manager.processNote(active.getId(), true, n -> n);
    verify(repo).get(eq(active.getId()), anyString(), any());
  }

  @Test
  void delayedLoadCannotReplaceAnAdmittedNoteFromANewerTreeGeneration() throws Exception {
    Note stored = createNote("/tree-generation");
    String saved = noteParser.toJson(stored);
    CountDownLatch firstLoadStarted = new CountDownLatch(1);
    CountDownLatch releaseFirstLoad = new CountDownLatch(1);
    java.util.concurrent.atomic.AtomicInteger loads = new java.util.concurrent.atomic.AtomicInteger();
    InMemoryNotebookRepo repo = new InMemoryNotebookRepo() {
      @Override
      public Note get(String id, String path, AuthenticationInfo subject) throws IOException {
        if (loads.incrementAndGet() == 1) {
          firstLoadStarted.countDown();
          try {
            if (!releaseFirstLoad.await(5, TimeUnit.SECONDS)) {
              throw new IOException("Timed out waiting for the newer tree to load");
            }
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException(e);
          }
        }
        return NoteManagerTest.this.noteParser.fromJson(id, saved);
      }
    };
    repo.save(stored, AuthenticationInfo.ANONYMOUS);
    NoteManager manager = new NoteManager(repo, zConf);
    ExecutorService executor = Executors.newSingleThreadExecutor();
    Note admitted = null;
    try {
      java.util.concurrent.Future<Note> oldLoad = executor.submit(() ->
          manager.processNote(stored.getId(), n -> n));
      assertTrue(firstLoadStarted.await(5, TimeUnit.SECONDS));
      manager.reloadNotes();
      admitted = manager.processNote(stored.getId(), n -> {
        n.beginParagraphExecution();
        return n;
      });
      releaseFirstLoad.countDown();
      assertSame(admitted, oldLoad.get(5, TimeUnit.SECONDS));
      assertSame(admitted, manager.processNote(stored.getId(), n -> n));
      assertFalse(admitted.canChangePersonalizedMode());
      assertEquals(2, loads.get());
    } finally {
      releaseFirstLoad.countDown();
      if (admitted != null) {
        admitted.endParagraphExecution();
      }
      executor.shutdownNow();
    }
  }

  @Test
  void testLruCache() throws IOException {

    int cacheThreshold = zConf.getNoteCacheThreshold();

    // fill cache
    for (int i = 0; i < cacheThreshold; ++i) {
      Note note = createNote("/prod/note" + i);
      noteManager.addNote(note, AuthenticationInfo.ANONYMOUS);
    }
    assertEquals(cacheThreshold, noteManager.getCacheSize());

    // add cache + 1
    Note noteNew = createNote("/prod/notenew");
    noteManager.addNote(noteNew, AuthenticationInfo.ANONYMOUS);
    // check for first eviction
    assertEquals(cacheThreshold, noteManager.getCacheSize());

    // add notes with read flag
    for (int i = 0; i < cacheThreshold; ++i) {
      Note note = createNote("/prod/noteDirty" + i);
      note.getLock().readLock().lock();
      noteManager.addNote(note, AuthenticationInfo.ANONYMOUS);
    }
    assertEquals(cacheThreshold, noteManager.getCacheSize());

    // add cache + 1 with read flag
    Note noteNew2 = createNote("/prod/notenew2");
    noteNew2.getLock().readLock().lock();
    noteManager.addNote(noteNew2, AuthenticationInfo.ANONYMOUS);

    // since all notes in the cache are with a read lock, the cache grows
    assertEquals(cacheThreshold + 1, noteManager.getCacheSize());

    assertTrue(noteManager.containsNote(noteNew2.getPath()));
    noteManager.removeNote(noteNew2.getId(), AuthenticationInfo.ANONYMOUS);
    assertFalse(noteManager.containsNote(noteNew2.getPath()));
    assertEquals(cacheThreshold, noteManager.getCacheSize());

    // add cache + 1 without read flag
    Note noteNew3 = createNote("/prod/notenew3");
    noteManager.addNote(noteNew3, AuthenticationInfo.ANONYMOUS);

    // since all dirty notes in the cache are with a read flag, the cache removes noteNew3, because it has no read flag
    assertEquals(cacheThreshold, noteManager.getCacheSize());
    assertTrue(noteManager.containsNote(noteNew3.getPath()));
  }

  @Test
  void testRemoveFolderEvictsNoteCache() throws IOException {
    // add 2 notes under the same folder
    Note note1 = createNote("/folder1/note1");
    Note note2 = createNote("/folder1/note2");
    noteManager.addNote(note1, AuthenticationInfo.ANONYMOUS);
    noteManager.addNote(note2, AuthenticationInfo.ANONYMOUS);
    assertEquals(2, noteManager.getCacheSize());

    // remove folder should evict its notes from the cache as well
    noteManager.removeFolder("/folder1", AuthenticationInfo.ANONYMOUS);
    assertEquals(0, noteManager.getCacheSize());
  }

  @Test
  void testConcurrentOperation() throws Exception {
    int threshold = 10, noteNum = 150;
    Map<Integer, String> notes = new ConcurrentHashMap<>();
    ExecutorService threadPool = Executors.newFixedThreadPool(threshold);
    // Save note concurrently
    ConcurrentTask saveNote = new ConcurrentTaskSaveNote(threadPool, noteNum, notes, "/prod/note%s");
    saveNote.exec();
    // Move note concurrently
    ConcurrentTask moveNote = new ConcurrentTaskMoveNote(threadPool, noteNum, notes, "/dev/project_%s/my_note%s");
    moveNote.exec();
    // Move folder concurrently
    ConcurrentTask moveFolder = new ConcurrentTaskMoveFolder(threadPool, noteNum, notes, "/staging/note_%s/my_note%s");
    moveFolder.exec();
    // Remove note concurrently
    ConcurrentTask removeNote = new ConcurrentTaskRemoveNote(threadPool, noteNum, notes, null);
    removeNote.exec();
    threadPool.shutdown();
  }

  @Test
  void testConcurrentReloadAndProcessNote() throws Exception {
    int noteNum = 50, readerNum = 4, reloadRounds = 30;
    Map<Integer, String> notes = new ConcurrentHashMap<>();
    for (int i = 0; i < noteNum; i++) {
      Note note = createNote(String.format("/prod/note_%s", i));
      noteManager.saveNote(note);
      notes.put(i, note.getId());
    }

    List<Throwable> failures = Collections.synchronizedList(new ArrayList<>());
    AtomicBoolean reloading = new AtomicBoolean(true);
    ExecutorService threadPool = Executors.newFixedThreadPool(readerNum + 1);
    CountDownLatch done = new CountDownLatch(readerNum + 1);

    // Reload the whole note tree repeatedly while other threads read the notes
    threadPool.execute(() -> {
      try {
        for (int i = 0; i < reloadRounds; i++) {
          noteManager.reloadNotes();
        }
      } catch (Throwable t) {
        failures.add(t);
      } finally {
        reloading.set(false);
        done.countDown();
      }
    });

    for (int i = 0; i < readerNum; i++) {
      threadPool.execute(() -> {
        try {
          while (reloading.get()) {
            for (String noteId : notes.values()) {
              assertNotNull(noteManager.processNote(noteId, note -> note),
                  "processNote() found no note for an existing noteId during reload");
            }
          }
        } catch (Throwable t) {
          failures.add(t);
        } finally {
          done.countDown();
        }
      });
    }

    assertTrue(done.await(60, TimeUnit.SECONDS), "Concurrent reload did not finish in time");
    threadPool.shutdown();
    if (!failures.isEmpty()) {
      throw new AssertionError(failures.size()
          + " note operation(s) failed while the note tree was being reloaded", failures.get(0));
    }
  }

  abstract class ConcurrentTask {
    private ExecutorService threadPool;
    private int noteNum;
    private Map<Integer, String> notes;
    private String pathPattern;

    public ConcurrentTask(ExecutorService threadPool, int noteNum, Map<Integer, String> notes, String pathPattern) {
      this.threadPool = threadPool;
      this.noteNum = noteNum;
      this.notes = notes;
      this.pathPattern = pathPattern;
    }

    public abstract void run(int index) throws IOException;

    public void exec() throws Exception {
      // Simulate concurrent operation
      CountDownLatch latch = new CountDownLatch(noteNum);
      for (int i = 0; i < noteNum; i++) {
        int index = i;
        threadPool.execute(() -> {
          try {
            this.run(index);
            latch.countDown();
          } catch (IOException e) {
            e.printStackTrace();
          }
        });
      }
      // wait till all tasks are completed with 5 seconds as timeout threshold
      assertTrue(latch.await(5, TimeUnit.SECONDS));
      this.checkPathByPattern();
    }

    private void checkPathByPattern() throws IOException {
      assertEquals(this.notes.size(), noteManager.getNotesInfo().size());
      if (notes.isEmpty()) return;
      for (Integer key : this.notes.keySet()) {
        String expectPath = String.format(this.pathPattern, key, key);
        assertEquals(expectPath, noteManager.processNote(notes.get(key), n -> n).getPath());
      }
    }
  }

  class ConcurrentTaskSaveNote extends ConcurrentTask {
    public ConcurrentTaskSaveNote(ExecutorService threadPool, int noteNum, Map<Integer, String> notes, String pathPattern) {
      super(threadPool, noteNum, notes, pathPattern);
    }

    @Override
    public void run(int index) throws IOException {
      String tarPath = String.format(super.pathPattern, index, index);
      Note note = createNote(tarPath);
      noteManager.saveNote(note);
      super.notes.put(index, note.getId());
    }
  }

  class ConcurrentTaskMoveNote extends ConcurrentTask {
    public ConcurrentTaskMoveNote(ExecutorService threadPool, int noteNum, Map<Integer, String> notes, String pathPattern) {
      super(threadPool, noteNum, notes, pathPattern);
    }

    @Override
    public void run(int index) throws IOException {
      String tarPath = String.format(super.pathPattern, index, index);
      noteManager.moveNote(super.notes.get(index), tarPath, AuthenticationInfo.ANONYMOUS);
    }
  }

  class ConcurrentTaskMoveFolder extends ConcurrentTask {
    public ConcurrentTaskMoveFolder(ExecutorService threadPool, int noteNum, Map<Integer, String> notes, String pathPattern) {
      super(threadPool, noteNum, notes, pathPattern);
    }

    @Override
    public void run(int index) throws IOException {
      String curPath = "/dev/project_" + index, tarPath = "/staging/note_" + index;
      noteManager.moveFolder(curPath, tarPath, AuthenticationInfo.ANONYMOUS);
    }
  }

  class ConcurrentTaskRemoveNote extends ConcurrentTask {
    public ConcurrentTaskRemoveNote(ExecutorService threadPool, int noteNum, Map<Integer, String> notes, String pathPattern) {
      super(threadPool, noteNum, notes, pathPattern);
    }

    @Override
    public void run(int index) throws IOException {
      noteManager.removeNote(super.notes.get(index), AuthenticationInfo.ANONYMOUS);
      super.notes.remove(index);
    }
  }
}
