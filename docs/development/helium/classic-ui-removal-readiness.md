---
layout: page
title: "Classic UI removal readiness"
description: "Helium compatibility and Classic UI migration validation"
group: development/helium
---
<!--
Licensed to the Apache Software Foundation (ASF) under one or more
contributor license agreements. See the NOTICE file distributed with
this work for additional information regarding copyright ownership.
The ASF licenses this file to You under the Apache License, Version 2.0
(the "License"); you may not use this file except in compliance with
the License. You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
{% include JB/setup %}

# Classic UI removal readiness (work in progress)

This is a source-backed migration checklist, not a claim that the Classic UI or
Helium can be removed. It compares `zeppelin-web/` with `zeppelin-web-angular/`
at `origin/master` commit `bd1ecc6dc442c8b05124ae7afc1233006e21441d`, plus the
local changes in `feature/classic-helium-parity-20260924`. A source gap does not
prove a feature is unused; usage and saved-note formats still need measuring.

| Capability | Current state in this worktree | Removal gate |
| --- | --- | --- |
| Notebook-wide find/replace | The new UI's inactive buttons are wired to literal, ordered paragraph search and replacement. Unit tests cover navigation, empty terms, duplicate matches, and replacement. | Browser-test selection, save and collaborative-mode behavior. Hidden editors and view-only pages currently scroll to a matching paragraph but cannot select text in Monaco. |
| Duplicate table headers | The `@antv/data-set` TSV parser previously collapsed two same-named fields into one object property. The new parser assigns distinct internal keys while keeping the original display/export labels, and the Classic Helium adapter receives both values. Unit tests cover duplicates and name collisions. | Browser-test table, charts, saved graph settings, and CSV/TSV/XLSX export with duplicate headers. Chart settings use distinct internal names, which may differ from persisted Classic settings. |
| Classic visualization lifecycle | Result teardown now cleans only instances for its paragraph; it no longer destroys every Classic visualization in the shared service. A unit test covers neighboring paragraph IDs. | Browser-test multiple result components and mode switching, including delayed bundle loading. This is a containment fix, not Helium removal. |
| `%network` output | The new UI now parses `GraphResult` JSON and renders a native SVG graph with labels, directed edges, and selected entity details. Model tests cover the normal graph contract, multiple edges, loops, invalid data, and color fallback. | Browser-test real interpreter results and saved notes. The current circular layout does not replace Classic's force layout, drag/pan/zoom, or transformation/settings controls. |
| Helium shared packages | `zeppelin-helium/` now owns `zeppelin-tabledata`, `zeppelin-vis`, and `zeppelin-spell`. The server resolves these sources or distribution `lib/node_modules`, without inspecting or loading `zeppelin-web/`. Classic webpack also uses these canonical packages. | Validate actual bundles and release packaging. The retained Classic copies are no longer the canonical source. |
| Helium visualization packages | The new UI retains its AngularJS compatibility service, including scopes, templates and drag/drop shims. Its templates live in the new UI's own assets. | Inventory third-party packages and saved `graph.mode` IDs, then verify mode/config persistence. Retaining this bridge does not require retaining Classic UI. |
| Helium Spell | Enabled bundles are initialized through a shared Promise before dispatch. The new UI handles `ELEMENT` callbacks and recursively rendered custom display types, with cycle/depth and stale-result guards. Server propagation uses serializable source magic/text instead of callbacks. Remote execution events do not retransmit results. | Browser-test actual packages, multiple clients, and saved-note replay. Unit tests establish the execution contracts, not arbitrary third-party compatibility. |
| Helium Application | The new UI has an Application selector, suggest/load REST integration, APP_* state handling, and an isolated AngularJS runtime for templates, inline Application JavaScript, and bidirectional AngularObjects. View scopes are destroyed on replacement. Published React rendering falls back to the new Angular host for Application paragraphs. | Validate real interpreter execution and third-party packages. External `<script src>` output currently reports an explicit unsupported error. AngularJS remains an npm compatibility dependency; it is not the Classic UI application. |
| Online interpreter installation | The new UI now exposes the existing admin-protected `/interpreter/install` endpoint using a Maven coordinate form and shows the server's start/success/failure WebSocket status. Unit tests cover request shape, input validation, and callback matching. | Browser-test the admin flow and installation failures against a disposable server. This does not reproduce Classic's Helium registry discovery or prove arbitrary interpreter compatibility. |

The target is to retain Helium while decoupling it from Classic UI, not to remove
Helium or AngularJS. Do not remove Helium server APIs or the compatibility bridge.
A Classic UI removal PR still needs
the gates above, captured saved-note fixtures, browser-level parity checks, and
a migration/deprecation policy for third-party packages.

Local validation: `npm run test:shell` passed 183 tests across 32 files;
the production Angular build and TypeScript check passed. The WebSocket
contract check passed (85 wire operations and one frontend-only operation).
The server build, two source/distribution path tests, and the 56-module RAT
check passed. A generated distribution archive contained byte-identical copies
of the three canonical Helium packages.
The server bundled the actual horizontalbar and echo examples in a temporary
`ZEPPELIN_HOME` containing no `zeppelin-web` directory. This test passed twice.
The existing Helium REST tests passed all seven cases.

Chromium validation used the actual `zeppelin-example-clock` HTML with mocked
REST/WebSocket traffic on a disposable local server. It passed initial rendering,
AngularObject updates, other-note isolation, Output/Application switching,
cached remount, and object removal, with no inbound-update echo or page errors.
Inline `$z.scope`/`$z.result` scripts and ng-model changes sent back to the server
also passed. The actual echo bundle executed with repeat configuration and sent
serializable Spell results; the actual horizontalbar bundle rendered two bars.
Four Chromium harnesses passed 17 checks, including TEXT-to-TABLE-to-TEXT
replacement and restoring the last-result Application selection while retaining
earlier native outputs. Monaco reported an unrelated local `file:` font URL
error; there were no page exceptions or outbound external requests.
Navigation/disposal while waiting for Spell initialization is covered by unit
tests that assert neither the old Spell nor a backend paragraph is dispatched.
This establishes browser rendering and protocol handling, not an integrated
browser-to-interpreter Application run. Live interpreter installation, two real
browser instances against a server, and arbitrary third-party package
compatibility remain unverified. Classic Karma compilation passed, but Firefox
execution was unavailable.

The upstream `HeliumApplicationFactoryTest` had five disabled tests. Its
load/run/unload case is now enabled and passes on the pinned Java 11 runtime
against a separate mock interpreter process. The test fixture forwards remote
Application events to the factory and waits for the first and second outputs
(`Hello world 1` and `Hello world 2`) and unload. In investigating the original
failure, a thread dump exposed a server-side deadlock: a lifecycle RPC held
the `ApplicationState` monitor while the interpreter's output callback needed
that same monitor. Lifecycle RPCs now use a separate transient per-application
lock. The other four Application tests remain disabled and do not count as
execution evidence.

Two `HeliumApplicationService` instances now pass a shared event-stream test,
including a late client restored from a note snapshot. A separate Java 11
integration test starts Zeppelin, connects two real WebSocket clients to the
same note, and verifies that an Application output callback reaches both with
the correct note, paragraph, app, and output. A third, later WebSocket client
receives the updated Application output inside its `NOTE` snapshot. This proves
server fan-out and replay, but not rendering in two real browsers or an
end-to-end browser-to-interpreter run. A published
third-party `zeppelin-bubblechart@0.0.3` package builds and registers a
visualization constructor in Chromium; this does not prove it renders or that
arbitrary packages work. The actual echo and horizontalbar example bundles
were rendered in the previous isolated browser harness. Application output
containing external `<script src>` is still explicitly unsupported in the new
runtime, so full third-party Application compatibility cannot yet be claimed.
