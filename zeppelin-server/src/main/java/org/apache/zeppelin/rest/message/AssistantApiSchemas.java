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

package org.apache.zeppelin.rest.message;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.ws.rs.core.Response.Status;
import java.util.List;
import org.apache.zeppelin.server.JsonResponse;

/** Schema bindings for JAX-RS methods whose return type is Response. */
public final class AssistantApiSchemas {
  private AssistantApiSchemas() {}

  @Schema(name = "AssistantConversationListResponse", requiredProperties = {"status", "body"})
  public static class ConversationList extends JsonResponse<List<ConversationMetadata>> {
    public ConversationList() { super(Status.OK); }
  }

  @Schema(name = "AssistantConversationMetadataResponse", requiredProperties = {"status", "body"})
  public static class Metadata extends JsonResponse<ConversationMetadata> {
    public Metadata() { super(Status.OK); }
  }

  @Schema(name = "AssistantConversationDetailResponse", requiredProperties = {"status", "body"})
  public static class Detail extends JsonResponse<ConversationResponse> {
    public Detail() { super(Status.OK); }
  }

  @Schema(name = "AssistantMessageListResponse", requiredProperties = {"status", "body"})
  public static class Messages extends JsonResponse<MessagesResponse> {
    public Messages() { super(Status.OK); }
  }

  @Schema(name = "AssistantRenameConversationRequest", requiredProperties = {"title"})
  public static class Rename {
    @Schema(minLength = 1, description = "Must not be blank (String.isBlank)")
    public String title;
  }
}
