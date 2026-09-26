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

import org.jvnet.hk2.annotations.Service;
import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Function;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.ServiceUnavailableException;
import jakarta.ws.rs.WebApplicationException;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.notebook.AuthorizationService;
import org.apache.zeppelin.notebook.Notebook;
import org.apache.zeppelin.rest.exception.NoteNotFoundException;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.user.AuthenticationInfo;

@Service
public class NotebookAssistantService {

  private final AuthorizationService authorizationService;

  private final Map<String, Object> noteLocks = new ConcurrentHashMap<>();

  private final Set<String> activeConversations = ConcurrentHashMap.newKeySet();
  private final ZeppelinConfiguration zConf;
  private final Notebook notebook;
  private final OpenAiClient openAiClient;
  private final ParagraphToolExecutor toolExecutor;

  @Inject
  public NotebookAssistantService(ZeppelinConfiguration zConf,
                                  Notebook notebook,
                                  OpenAiClient openAiClient,
                                  ParagraphToolExecutor toolExecutor,
                                  AuthorizationService authorizationService) {
    this.authorizationService = authorizationService;
    this.zConf = zConf;
    this.notebook = notebook;
    this.openAiClient = openAiClient;
    this.toolExecutor = toolExecutor;
  }

  private Object lockFor(String noteId) {
    return noteLocks.computeIfAbsent(noteId, k -> new Object());
  }

  private void ensureAvailable() {
    if (!zConf.isNotebookAssistantEnabled() || zConf.getNotebookAssistantApiKey() == null
        || zConf.getNotebookAssistantApiKey().isBlank()) {
      throw new ServiceUnavailableException("Notebook Assistant is not configured");
    }
  }

  public List<Conversation> listConversations(String noteId, ServiceContext ctx)
      throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, false);
    return readStore(noteId, ctx.getAutheInfo(), ConversationStore::findAll);
  }

  public Conversation createConversation(String noteId, String title, ServiceContext ctx)
      throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, true);
    var conversation = Conversation.create(noteId, title);
    synchronized (lockFor(noteId)) {
      mutateStore(noteId, ctx.getAutheInfo(), store -> store.add(conversation));
    }
    return conversation;
  }

  public Conversation getConversation(String noteId, String conversationId, ServiceContext ctx)
      throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, false);
    return readStore(noteId, ctx.getAutheInfo(), store -> store.find(conversationId))
        .orElseThrow(NotFoundException::new);
  }

  public void deleteConversation(String noteId, String conversationId, ServiceContext ctx)
      throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, true);
    if (activeConversations.contains(conversationId)) {
      throw new WebApplicationException("Conversation is running", 409);
    }
    synchronized (lockFor(noteId)) {
      mutateStore(noteId, ctx.getAutheInfo(), store -> {
        if (!store.remove(conversationId)) {
          throw new NotFoundException("Conversation not found: " + conversationId);
        }
      });
    }
  }

  public List<Message> getMessages(String noteId, String conversationId, ServiceContext ctx)
      throws IOException {
    return getConversation(noteId, conversationId, ctx).getMessages();
  }

  private <T> T readStore(String noteId, AuthenticationInfo subject,
                          Function<ConversationStore, T> mapper) throws IOException {
    return notebook.processNote(noteId, note -> {
      if (note == null) {
        throw new NoteNotFoundException(noteId);
      }
      return mapper.apply(ConversationStore.attach(note, subject));
    });
  }

  private void mutateStore(String noteId, AuthenticationInfo subject,
                           Consumer<ConversationStore> action) throws IOException {
    notebook.processNote(noteId, note -> {
      if (note == null) {
        throw new NoteNotFoundException(noteId);
      }
      ConversationStore store = ConversationStore.attach(note, subject);
      action.accept(store);
      store.flush();
      notebook.saveNote(note, subject);
      return null;
    });
  }

  private void checkPermission(String noteId, ServiceContext ctx, boolean write) {
    boolean allowed = write
        ? authorizationService.isWriter(noteId, ctx.getUserAndRoles())
        : authorizationService.isReader(noteId, ctx.getUserAndRoles());
    if (!allowed) {
      throw new ForbiddenException("Insufficient notebook privileges");
    }
  }

  // --- Message send (SSE streaming) ---

  public void validateMessage(String noteId, String conversationId, String content,
                              ServiceContext ctx) throws IOException {
    ensureAvailable();
    checkPermission(noteId, ctx, true);
    if (content == null || content.isBlank()) {
      throw new BadRequestException("content must be a nonempty string");
    }
    getConversation(noteId, conversationId, ctx);
    if (activeConversations.contains(conversationId)) {
      throw new WebApplicationException("Conversation is running", 409);
    }
  }

  public void sendMessage(String noteId, String conversationId, String userContent,
                          ServiceContext ctx,
                          OutputStream sseOut) {
    throw new UnsupportedOperationException("sendMessage not yet implemented");
  }
}
