# Assistant Conversation API

Base path: `/api/notes/{noteId}/conversations`

All responses are wrapped in `JsonResponse` (`{ status, message, body }`).
The examples below show only the `body` part.

---

## 1. List

```
GET /api/notes/{noteId}/conversations
```

**200 OK**

```json
[
  {
    "id": "conv_abc1234567890def",
    "note_id": "2F2YS7PCE",
    "title": "Test conversation",
    "created_at": "2026-09-26T10:00:00Z",
    "updated_at": "2026-09-26T10:05:00Z",
    "messages": []
  }
]
```

> `messages` is included even in list responses. Ignore it on the frontend if not needed.

---

## 2. Get

```
GET /api/notes/{noteId}/conversations/{conversationId}
```

**200 OK** — see the `Conversation` schema below.

---

## 3. Create

```
POST /api/notes/{noteId}/conversations
Content-Type: application/json

{ "title": "Test conversation" }
```

- `title` is required. Missing → **400 Bad Request**.

**201 Created** — returns the created `Conversation`.

---

## 4. Delete

```
DELETE /api/notes/{noteId}/conversations/{conversationId}
```

**204 No Content**

---

## Schema

### Conversation

| Field | Type | Description |
|---|---|---|
| `id` | string | `conv_` prefix |
| `note_id` | string | Owning note ID |
| `title` | string | Conversation title |
| `created_at` | string (ISO-8601) | Created timestamp |
| `updated_at` | string (ISO-8601) | Last-updated timestamp |
| `messages` | Message[] | Message list (see below) |

### Message (shape varies by role)

Common:
- `id` (string, `msg_` prefix)
- `role` (`"user"` \| `"assistant"` \| `"tool"` \| `"system"`)
- `created_at` (string)

Role-specific fields:

```jsonc
// user
{ "id": "...", "role": "user", "content": "hi", "created_at": "..." }

// assistant
{
  "id": "...", "role": "assistant", "created_at": "...",
  "content": "Hello.",
  "tool_calls": [ /* optional */ ]
}

// tool
{
  "id": "...", "role": "tool", "created_at": "...",
  "tool_call_id": "call_xxx",
  "content": "tool execution result"
}
```

For sending messages / streaming, see the separate API at
`.../conversations/{conversationId}/messages` — examples in
`docs/notebook-assistant.http`.
