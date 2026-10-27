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

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.apache.zeppelin.interpreter.InterpreterFactory;
import org.apache.zeppelin.interpreter.InterpreterResult;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Note;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.notebook.Notebook.NoteProcessor;
import org.apache.zeppelin.scheduler.Job.Status;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.user.AuthenticationInfo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Calls a real model. Skipped unless the API key is set in the environment, under the same
 * variable the server reads:
 * ZEPPELIN_ASSISTANT_OPENAI_API_KEY=... ./mvnw package -pl zeppelin-server --am
 * -Dtest=AssistantE2ETest -Dsurefire.failIfNoSpecifiedTests=false -DskipTests=false
 */
@EnabledIfEnvironmentVariable(named = AssistantE2ETest.API_KEY_ENV, matches = ".+")
class AssistantE2ETest {
  static final String API_KEY_ENV = "ZEPPELIN_ASSISTANT_OPENAI_API_KEY";
  // Only in the paragraph result, so the model must call get_paragraph to answer.
  private static final String TOKEN = "zx-8841-qp";
  private static final String BASE_URL = "https://api.openai.com/v1";
  private static final String MODEL = "gpt-6-luna";

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @AfterEach
  void tearDown() {
    executor.shutdownNow();
  }

  @Test
  void answersWithMultipleTools() throws Exception {
    var authInfo = new AuthenticationInfo("holden");
    var userAndRoles = Set.of("user");

    var note = new Note();
    note.setInterpreterFactory(mock(InterpreterFactory.class));
    note.addNewParagraph(authInfo).setText("%md # Intro");

    var paragraph = note.addNewParagraph(authInfo);
    paragraph.setText("%python\nprint(token())");
    paragraph.setStatus(Status.FINISHED);
    paragraph.setResult(new InterpreterResult(InterpreterResult.Code.SUCCESS, TOKEN));
    assertFalse(paragraph.getText().contains(TOKEN));

    var notebook = mock(Notebook.class);
    when(notebook.processNote(eq("noteId"), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(1)).process(note));
    when(notebook.processNote(eq("noteId"), eq(false), any()))
        .thenAnswer(invocation -> ((NoteProcessor<?>) invocation.getArgument(2)).process(note));

    var authorization = mock(AuthorizationService.class);
    when(authorization.isReader("noteId", userAndRoles)).thenReturn(true);

    var conversation = Conversation.create("noteId", "e2e", authInfo.getUser());
    var repository = mock(ConversationRepository.class);
    when(repository.find("noteId", conversation.getId())).thenReturn(Optional.of(conversation));
    doAnswer(invocation -> {
      Conversation target = invocation.getArgument(0);
      Consumer<Conversation> update = invocation.getArgument(1);
      update.accept(target);
      return null;
    }).when(repository).update(any(), any());

    var userQuery = "What exact text did the second paragraph output? Quote it verbatim.";
    var toolNames = new ArrayList<String>();
    var answer = new StringBuilder();
    var failures = new ArrayList<String>();

    try (var model = new OpenAiChatModel(BASE_URL, System.getenv(API_KEY_ENV), MODEL)) {
      var sut = new AssistantImpl(
          notebook,
          model,
          new NotebookService(notebook, authorization, null, null),
          authorization,
          repository,
          executor
      );

      sut.sendMessage("noteId", conversation.getId(),
          userQuery, authInfo, userAndRoles,
          (type, payload) -> {
            if (payload instanceof AssistantEventPayload.ToolCallStarted) {
              toolNames.add(((AssistantEventPayload.ToolCallStarted) payload).name);
            } else if (payload instanceof AssistantEventPayload.MessageDone) {
              answer.append(((AssistantEventPayload.MessageDone) payload).content);
            } else if (payload instanceof AssistantEventPayload.RunFailed) {
              var failed = (AssistantEventPayload.RunFailed) payload;
              failures.add("RUN_FAILED runId=" + failed.runId + " status=" + failed.error.status);
            }
          }
      ).get(2, TimeUnit.MINUTES);

      System.out.println(userQuery);
      System.out.println("Assistant tools: " + toolNames);
      System.out.println("Assistant response:\n" + answer);

      assertTrue(failures.isEmpty(), failures.toString());
      assertTrue(toolNames.contains("list_paragraphs"), toolNames.toString());
      assertTrue(toolNames.contains("get_paragraph"), toolNames.toString());
      assertTrue(answer.toString().contains(TOKEN), answer.toString());
    }
  }
}
