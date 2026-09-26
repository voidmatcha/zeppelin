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

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.Map;
import java.util.Set;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Notebook.NoteProcessor;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.rest.exception.ForbiddenException;
import org.apache.zeppelin.rest.exception.ParagraphNotFoundException;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ParagraphToolExecutorTest {
  private Note note;
  private AuthorizationService authorization;
  private ParagraphToolExecutor tools;
  private final ServiceContext ctx = new ServiceContext(AuthenticationInfo.ANONYMOUS, Set.of("user"));

  @BeforeEach
  void setUp() throws Exception {
    note = new Note();
    note.setInterpreterFactory(mock(org.apache.zeppelin.interpreter.InterpreterFactory.class));
    Notebook notebook = mock(Notebook.class);
    when(notebook.processNote(anyString(), any())).thenAnswer(i ->
        ((NoteProcessor<?>) i.getArgument(1)).process(note));
    when(notebook.processNote(anyString(), anyBoolean(), any())).thenAnswer(i ->
        ((NoteProcessor<?>) i.getArgument(2)).process(note));
    authorization = mock(AuthorizationService.class);
    when(authorization.isReader(anyString(), anySet())).thenReturn(true);
    when(authorization.isWriter(anyString(), anySet())).thenReturn(true);
    tools = new ParagraphToolExecutor(new NotebookService(notebook, authorization,
        mock(ZeppelinConfiguration.class), null));
  }

  @Test
  void rejectsAllToolsWithoutReadPermission() {
    when(authorization.isReader(anyString(), anySet())).thenReturn(false);
    for (String tool : new String[] {"list_paragraphs", "get_paragraph", "add_paragraph",
        "update_paragraph", "delete_paragraph"}) {
      assertThrows(ForbiddenException.class, () -> tools.callTool("note", tool, Map.of(), ctx));
    }
  }

  @Test
  void readerCannotModifyParagraphs() {
    Paragraph p = note.addNewParagraph(AuthenticationInfo.ANONYMOUS);
    p.setText("original");
    when(authorization.isWriter(anyString(), anySet())).thenReturn(false);
    assertThrows(ForbiddenException.class, () -> tools.callTool("note", "update_paragraph",
        Map.of("paragraph_id", p.getId(), "text", "changed"), ctx));
    assertThrows(ForbiddenException.class, () -> tools.callTool("note", "delete_paragraph",
        Map.of("paragraph_id", p.getId()), ctx));
    assertThrows(ForbiddenException.class, () -> tools.callTool("note", "add_paragraph",
        Map.of("text", "%md new"), ctx));
    assertEquals("original", p.getText());
    assertEquals(1, note.getParagraphCount());
  }

  @Test
  void protectsAssistantMarkerParagraph() throws Exception {
    Paragraph p = note.addNewParagraph(AuthenticationInfo.ANONYMOUS);
    p.setConfig(Map.of("notebookAssistant", true));
    for (String tool : new String[] {"get_paragraph", "update_paragraph", "delete_paragraph"}) {
      assertThrows(ParagraphNotFoundException.class,
          () -> tools.callTool("note", tool, Map.of("paragraph_id", p.getId()), ctx));
    }
    assertEquals(java.util.List.of(), tools.callTool("note", "list_paragraphs", Map.of(), ctx));
    assertEquals(1, note.getParagraphCount());
  }
}
