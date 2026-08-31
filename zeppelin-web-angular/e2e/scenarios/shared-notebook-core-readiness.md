<!--
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
      http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

# Shared Notebook Core Readiness

This checklist tracks the evidence required before the Angular notebook adapter
can rely on Shared Notebook Core as the single owner of migrated notebook state.
It is scoped to ZEPPELIN-6687 and is intentionally not an implementation of the
core store, command surface, transport adapter, or React notebook renderer.

## Required Evidence

| Gate | Evidence owner | Required proof |
| --- | --- | --- |
| Read-only mount contract | ZEPPELIN-6670 | `@zeppelin/notebook-core` exposes only `getSnapshot` and `subscribe`, with typecheck, unit tests, and import-boundary checks. |
| Same-object host/remote identity | ZEPPELIN-6674 | A browser test proves `Object.is(receivedPort, hostPort)` across separately built host and remote bundles. |
| Notebook route harness | ZEPPELIN-6675 | A checked-in route harness keeps one mounted React remote while note and revision context updates through the host-owned port, without moving production rendering. |
| Stale reply protection | ZEPPELIN-6683 | `INTERPRETER_BINDINGS`, `LIST_REVISION_HISTORY`, `SET_NOTE_REVISION`, and `NOTE_REVISION` replies preserve request identity and fail closed when stale, unknown, or outside the active note/revision route generation. |
| Fixture replay | ZEPPELIN-6666 | Browser-level REST and WebSocket recording and replay preserve schema and ordering, normalize nondeterministic fields, and write no authentication secrets without a custom WebSocket proxy. |

## Parent Close Rule

ZEPPELIN-6687 should stay open until the capability slices prove that migrated
commands name exactly one command transport, reducers are the only canonical
state writers, and Angular consumes the same immutable snapshots that later React
consumers receive through the host-owned port. Server listener legacy mode and
EventBus mode are fixture inputs to the transport tests; frontend core and
adapter code must not branch on the server dispatch mode.
