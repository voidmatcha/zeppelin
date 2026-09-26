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

import jakarta.inject.Inject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.zeppelin.notebook.Note;
import jakarta.ws.rs.BadRequestException;
import org.apache.zeppelin.rest.exception.ParagraphNotFoundException;
import org.apache.zeppelin.notebook.Paragraph;
import org.apache.zeppelin.service.NotebookService;
import org.apache.zeppelin.service.ServiceContext;
import org.apache.zeppelin.service.SimpleServiceCallback;
import org.jvnet.hk2.annotations.Service;

@Service
public class ParagraphToolExecutor {

  // Tool schema list in OpenAI function-calling format.
  public static final List<Map<String, Object>> TOOL_SCHEMAS;

  static {
    TOOL_SCHEMAS = new ArrayList<>();
    TOOL_SCHEMAS.add(buildSchema("list_paragraphs",
        "List the visible paragraphs of the notebook.",
        Map.of()));
    TOOL_SCHEMAS.add(buildSchema("get_paragraph",
        "Return the content and execution result of a specific paragraph.",
        Map.of("paragraph_id", strProp("paragraph id", true))));
    TOOL_SCHEMAS.add(buildSchema("add_paragraph",
        "Add a new paragraph to the notebook.",
        Map.of(
            "text",  strProp("Paragraph content (must include the interpreter prefix, e.g. %python\\n...)", true),
            "title", strProp("Paragraph title", false),
            "index", intProp("Insertion index. Appended at the end when omitted.")
        )));
    TOOL_SCHEMAS.add(buildSchema("update_paragraph",
        "Update the content of an existing paragraph.",
        Map.of(
            "paragraph_id", strProp("paragraph id", true),
            "text",         strProp("New content. Kept unchanged when omitted.", false),
            "title",        strProp("New title. Kept unchanged when omitted.", false)
        )));
    TOOL_SCHEMAS.add(buildSchema("delete_paragraph",
        "Delete a paragraph.",
        Map.of("paragraph_id", strProp("paragraph id", true))));
  }

  private final NotebookService notebookService;

  @Inject
  public ParagraphToolExecutor(NotebookService notebookService) {
    this.notebookService = notebookService;
  }

  public Object callTool(String noteId, String name, Map<String, Object> args,
      ServiceContext ctx) throws IOException {
    if (args == null) {
      throw new BadRequestException("Tool arguments must be an object");
    }
    return notebookService.getNote(noteId, ctx, callback(), note -> {
      switch (name) {
        case "list_paragraphs":
          List<Map<String, Object>> result = new ArrayList<>();
          for (int i = 0; i < note.getParagraphCount(); i++) {
            Paragraph p = note.getParagraph(i);
            if (!isAssistantMarker(p)) {
              Map<String, Object> info = paragraphInfo(p);
              info.put("index", i);
              result.add(info);
            }
          }
          return result;
        case "get_paragraph":
          return paragraphInfo(visibleParagraph(note, required(args, "paragraph_id")));
        case "add_paragraph":
          String text = required(args, "text");
          String title = str(args, "title");
          int index = note.getParagraphCount();
          if (args.containsKey("index")) {
            Object value = args.get("index");
            if (!(value instanceof Number) || ((Number) value).doubleValue() < 0
                || ((Number) value).doubleValue() > index
                || ((Number) value).doubleValue() != ((Number) value).intValue()) {
              throw new BadRequestException("Invalid paragraph index");
            }
            index = ((Number) value).intValue();
          }
          Paragraph added = notebookService.insertParagraph(noteId, index, Map.of(), ctx, callback());
          notebookService.updateParagraph(noteId, added.getId(), title, text,
              added.settings.getParams(), Map.of(), ctx, callback());
          return Map.of("id", added.getId(), "success", true);
        case "update_paragraph":
          Paragraph p = visibleParagraph(note, required(args, "paragraph_id"));
          String newText = args.containsKey("text") ? required(args, "text") : p.getText();
          String newTitle = args.containsKey("title") ? required(args, "title") : p.getTitle();
          notebookService.updateParagraph(noteId, p.getId(), newTitle, newText,
              p.settings.getParams(), Map.of(), ctx, callback());
          return Map.of("success", true);
        case "delete_paragraph":
          Paragraph removed = visibleParagraph(note, required(args, "paragraph_id"));
          notebookService.removeParagraph(noteId, removed.getId(), ctx, callback());
          return Map.of("success", true);
        default:
          throw new BadRequestException("Unknown tool: " + name);
      }
    });
  }

  private static Map<String, Object> paragraphInfo(Paragraph p) {
    Map<String, Object> info = new HashMap<>();
    info.put("id", p.getId());
    info.put("title", p.getTitle());
    info.put("text", p.getText());
    String text = p.getText();
    info.put("interpreter", text != null && text.startsWith("%")
        ? text.substring(1).split("\\s+", 2)[0] : "");
    if (p.getReturn() != null) {
      info.put("results", p.getReturn());
    }
    return info;
  }

  private static Paragraph visibleParagraph(Note note, String id) {
    Paragraph p = note.getParagraph(id);
    if (p == null || isAssistantMarker(p)) {
      throw new ParagraphNotFoundException(id);
    }
    return p;
  }

  static boolean isAssistantMarker(Paragraph p) {
    return Boolean.TRUE.equals(p.getConfig().get(ConversationStore.PARAGRAPH_CONFIG_KEY));
  }

  private static <T> SimpleServiceCallback<T> callback() {
    return new SimpleServiceCallback<T>() {
      @Override
      public void onFailure(Exception ex, ServiceContext context) throws IOException {
        if (ex instanceof RuntimeException) {
          throw (RuntimeException) ex;
        }
        throw new IOException(ex);
      }
    };
  }

  private static String required(Map<String, Object> args, String key) {
    String value = str(args, key);
    if (value == null) {
      throw new BadRequestException("Missing argument: " + key);
    }
    return value;
  }

  // --- schema builders ---

  private static Map<String, Object> buildSchema(String name, String description,
      Map<String, Object> properties) {
    List<String> required = new ArrayList<>();
    for (Map.Entry<String, Object> e : properties.entrySet()) {
      @SuppressWarnings("unchecked")
      Map<String, Object> prop = (Map<String, Object>) e.getValue();
      if (Boolean.TRUE.equals(prop.get("_required"))) {
        required.add(e.getKey());
      }
    }
    // _required is an internal marker; strip it from the emitted schema.
    Map<String, Object> cleanProps = new HashMap<>();
    for (Map.Entry<String, Object> e : properties.entrySet()) {
      @SuppressWarnings("unchecked")
      Map<String, Object> prop = new HashMap<>((Map<String, Object>) e.getValue());
      prop.remove("_required");
      cleanProps.put(e.getKey(), prop);
    }

    Map<String, Object> params = new HashMap<>();
    params.put("type", "object");
    params.put("properties", cleanProps);
    if (!required.isEmpty()) params.put("required", required);

    return Map.of(
        "type", "function",
        "function", Map.of(
            "name", name,
            "description", description,
            "parameters", params
        )
    );
  }

  private static Map<String, Object> strProp(String description, boolean required) {
    Map<String, Object> m = new HashMap<>();
    m.put("type", "string");
    m.put("description", description);
    m.put("_required", required);
    return m;
  }

  private static Map<String, Object> intProp(String description) {
    return Map.of("type", "number", "description", description);
  }

  private static String str(Map<String, Object> args, String key) {
    Object v = args.get(key);
    if (v != null && !(v instanceof String)) {
      throw new BadRequestException("Expected string: " + key);
    }
    return (String) v;
  }
}
