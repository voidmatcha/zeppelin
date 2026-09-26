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

package org.apache.zeppelin.rest;

import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;

import java.io.IOException;
import java.util.Optional;

import org.apache.zeppelin.annotation.ZeppelinApi;
import org.apache.zeppelin.rest.message.SendMessageRequest;
import org.apache.zeppelin.server.JsonResponse;
import org.apache.zeppelin.service.AuthenticationService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.service.assistant.NotebookAssistantService;

@Path("/notes/{noteId}/conversations/{conversationId}/messages")
@Produces("application/json")
@Singleton
public class AssistantMessageRestApi extends AbstractRestApi {

  private final NotebookAssistantService assistantService;

  @Inject
  public AssistantMessageRestApi(AuthenticationService authenticationService,
                                 NotebookAssistantService assistantService) {
    super(authenticationService);
    this.assistantService = assistantService;
  }

  @GET
  @ZeppelinApi
  public Response list(@PathParam("noteId") String noteId,
                       @PathParam("conversationId") String conversationId) throws IOException {
    return new JsonResponse<>(Response.Status.OK, "",
        assistantService.getMessages(noteId, conversationId, getServiceContext())).build();
  }

  @POST
  @Produces("text/event-stream")
  @ZeppelinApi
  public Response send(@PathParam("noteId") String noteId,
                       @PathParam("conversationId") String conversationId,
                       String body) throws IOException {

    String content = Optional.ofNullable(GSON.fromJson(body, SendMessageRequest.class))
        .map(SendMessageRequest::getContent)
        .orElseThrow(BadRequestException::new);
    ServiceContext ctx = getServiceContext();
    assistantService.validateMessage(noteId, conversationId, content, ctx);
    StreamingOutput stream = out -> assistantService.sendMessage(noteId, conversationId, content, ctx, out);
    return Response.ok(stream).type("text/event-stream").build();
  }
}
