<!--
Licensed to the Apache Software Foundation (ASF) under one or more
contributor license agreements.  See the NOTICE file distributed with
this work for additional information regarding copyright ownership.
The ASF licenses this file to You under the Apache License, Version 2.0
(the "License"); you may not use this file except in compliance with
the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Notebook transport contract fixtures

This directory defines the versioned REST and WebSocket fixture format used by
Notebook adapter tests. It is an in-repository contract test, not a Pact
consumer/provider contract and not a replacement for live-server E2E tests.

## Fixture ownership

Every committed fixture includes these required fields.
`createNotebookTransportRecorder` rejects a capture without them and
`validateFixture` reports them as errors. The replay adapter does not: it calls
`validateReplayFixture`, which checks record shape and ordering only, so a fixture
replayed without being validated first is never checked for metadata.

```json
{
  "version": 1,
  "metadata": {
    "scenario": "Open a notebook",
    "owner": "zeppelin-web-angular",
    "coveredOperations": ["GET_NOTE"],
    "knownExclusions": ["Live interpreter execution is covered by a separate E2E scenario"]
  },
  "records": [
    {
      "kind": "websocket",
      "sequence": 1,
      "websocket": { "direction": "send", "payloadText": "{\"op\":\"GET_NOTE\"}" }
    }
  ]
}
```

- `scenario` describes the user-visible flow.
- `owner` identifies the component that maintains the fixture.
- `coveredOperations` lists the REST or WebSocket operations represented by the
  fixture.
- `knownExclusions` records intentionally uncovered behavior. An empty array
  is valid when there are no exclusions.

Add a fixture when a Notebook operation is moved into the shared adapter
contract. If that operation cannot yet be represented, add its explicit reason
to the scenario's `knownExclusions`; do not silently rely on another fixture.

## Lifecycle fixtures

`notebook-lifecycle-fixture.mjs` composes raw version 1 transport records across
browser contexts and physical WebSocket connections. The lifecycle layer records
the active note and optional revision as capture context beside each raw record.
It never adds those identifiers to the captured payload. This distinction matters
for replies such as `NOTE_UPDATED`, whose wire envelope does not identify a note.
Run the composed capture through `sanitizeLifecycleFixture` before committing it;
the function applies the transport fixture's existing redaction without changing
the lifecycle context or causal annotations.
`createNotebookLifecycleRecorder` installs the version 1 recorder on each browser
page and assigns one global observed sequence as those real recorder callbacks
arrive. Callers supply the current route context and classify the reducer input;
the recorder does not infer note association from an untagged frame.

Each lifecycle record declares both its transport ingress and the operation path
that caused the authoritative reducer input. REST insert, move and remove flows
therefore retain their REST request and response records and label the later full
`NOTE` broadcast as the `full-note` input for the REST path. Their WebSocket
counterparts label `PARAGRAPH_ADDED`, `PARAGRAPH_REMOVED` and `PARAGRAPH_MOVED` as
the `granular-event` input. The two paths are not normalized into one payload.

Actors name independent browser `contextId` values. Authenticated actors must also
use distinct redacted `principalAlias` values. Connection IDs split traffic before
and after a physical reconnect. Note route contexts carry an `activeNoteId` and an
optional `revisionId`; the Job Manager uses the separate `job-manager` route kind
and carries no made-up note identifier. Route transitions are the only way a
connection's capture context may change; validation rejects an unexplained change
as invented association evidence.

The lifecycle replay runner can deterministically delay, duplicate, drop or reorder
selected records. It delivers the recorded timeout and reconciliation transitions
even when the record at that boundary was dropped, then compares every declared
actor snapshot with the server snapshot. A missing snapshot or divergence fails
closed. The ZEPPELIN-6672 contract additionally requires a dropped
`COMMIT_PARAGRAPH` to retain local dirty state until its timeout and declared
reconciliation path. Because the current wire has no positive commit reply, the
fixture records that protocol gap rather than manufacturing an acknowledgement.

The lifecycle schema has its own version. Unsupported versions, duplicate or
decreasing global sequence numbers, missing route associations, incomplete required
operation coverage and invalid fault targets are rejected before replay. The raw
records inside it remain transport version 1 and are validated by the original
transport validator.

## What transport version 1 does not model

A fixture records one observed interleaving of REST and WebSocket traffic and delivers
it in exactly that order. The migration plan this format serves does not assume the
observed order of an HTTP response and its related WebSocket events is guaranteed,
and the capture scenarios that follow this issue (ZEPPELIN-6671, ZEPPELIN-6672) have
to reproduce duplicate, reordered, late and dropped events. Version 1 cannot express
"either order is acceptable here": it can only pin the order that was captured.

A REST response occupies the position of Playwright's `requestfinished` event,
when its body has finished downloading. The earlier `response` event only supplies
headers. Reading the body with `response.text()` is asynchronous and must not move
that position past later WebSocket frames. `stop()` and `write()` wait for those
body reads; `stop()` also allows already captured responses to finish after it
stops accepting new traffic. This format replays complete response bodies, not
header-only availability, intermediate HTTP chunks or application callback timing.

For example, a client that awaits `fetch()` headers and sends another request or a
WebSocket acknowledgement before reading the body needs a separate header event.
Version 1 cannot reproduce that dependency and replay can stall. Such a scenario
must list this limitation in `knownExclusions`; capture validation checks record
structure, not whether application-level dependencies are replayable. Scenarios
using complete JSON responses should consume and assert those bodies during both
capture and replay.

What is pinned is the order the fixture *answers* in, not the order the page happens to
ask in, because a browser issues requests when it wants and a fixture cannot dictate
that. Two tolerances follow from it, and nothing beyond them:

- Consecutive REST request records form a request batch, ending at the next response
  or WebSocket record. Requests in that batch are matched by shape regardless of
  arrival order; responses retain their recorded order. For example, request A,
  request B, response A, response B replays when B arrives before A.
- A request that arrives while the fixture is expecting a WebSocket frame waits, as long
  as a later record answers it.

A request outside the current batch is rejected as a request mismatch. Response-only
fixtures contain no request batches, so they reject a different first request as out
of order. A request no remaining record can answer and a WebSocket frame that does
not match the next recorded frame are also rejected.

Two identical requests in flight at once cannot be told apart either. A record is
matched to a route by request shape - method, path, headers and body - so if a page
issues the same request twice concurrently and the capture recorded two different
responses, replay may hand each route the other's response and still report success.
Sequential requests are unaffected, because they are matched in arrival order.

`assertComplete()` requires every REST delivery to have settled successfully. A failed
fulfillment rejects its route and prevents successful completion, while independent
routes can still receive their recorded responses.

`principal` is redacted wherever it appears, and Zeppelin puts it on nearly every
WebSocket frame; `user`, `users` and `roles` go the same way. Permission arrays retain
their shape and cardinality, while scenario metadata distinguishes anonymous and
authenticated captures without storing an identity.

`accept`, `content-type` and `location` survive header filtering. `location` values use
the same credential redaction as URLs, which preserves the host's 401 redirect target
without recording tickets or tokens. Authentication response headers other than
`location`, including `set-cookie`, remain excluded.

Two more limits follow from the same transport shape. A record carries no timing, so a
scenario that turns on delay - a server change applied before an HTTP response times
out - cannot be replayed by the transport adapter alone. And a transport fixture
models one WebSocket connection, so lifecycle reconnection scenarios compose more
than one transport trace rather than weakening version 1. Capture rejects a second
notebook WebSocket connection, including a reconnect, instead of flattening
connections into a fixture that cannot be replayed.

That is deliberate. Widening the format before those scenarios exist would mean
designing for guesses. When a scenario needs it, the `version` field is the place to
introduce it, and a fixture written for an older version is rejected rather than
silently reinterpreted.

## Test layers

Run the format, redaction, ordering, and replay checks with:

```bash
npm run check:core-contract-fixtures
```

That covers the format, the redaction rules and the replay adapter against records,
and takes a couple of seconds. The capture server has a suite of its own, which starts
`capture-server.sh` for real against a stub to cover start, stop and pid-file
behaviour. It spawns processes and binds a free local port, so it takes tens of
seconds and runs in Maven's integration-test phase rather than on every build:

```bash
npm run check:core-contract-server
```

One thing neither layer reaches: the recorder's rejection of a binary WebSocket
frame. A frame can only be recorded from a real WebSocket server - a socket answered
by `route.fulfill` never opens, and one mocked with `routeWebSocket` does not raise
`page.on('websocket')` - so that path is covered only by the node test's event
emitter, and its behaviour under Playwright's own dispatch is unverified.

The checks above need no browser. What a browser adds is the adapter's contact with
Playwright's own `Request`, `Response`, `Route` and `WebSocket` objects, which a hand
written double cannot stand in for - a `route.continue()` that should have been
`route.fallback()` looked correct against doubles for a long time. Browser tests cover
that contact, including both HTTP-body-first and WebSocket-first exchanges against
a local server. A capture/replay round trip also checks requests without Accept, because Playwright does not
describe a request identically to a `page.on('request')` listener and to a `page.route`
handler:

```bash
npm run e2e:core-contract
```

The focused command uses `playwright.core-contract.config.js`. Its non-live mode
has no authentication setup, stored browser session, global setup/teardown or dev
server. It does not contact `PLAYWRIGHT_BASE_URL` or clean notebooks from another run.
The focused command runs Chromium. The ordinary E2E suite still includes the synthetic
browser tests in its Chromium, Firefox and WebKit projects and excludes `@live`.
The live capture project also exercises two independent browser contexts and a
physical reconnect through the lifecycle recorder. In Shiro mode it logs those
contexts in as two configured users and skips when the isolated server does not
provide two users, rather than recording a same-principal collaboration trace.

The capture server requires `lsof` to verify listener ownership. Build a clean detached
`origin/master` checkout with
`./mvnw clean install -DskipTests -pl zeppelin-server,zeppelin-web-angular,shell -am`,
then create a build manifest before starting a committed-fixture capture. The manifest
hashes every server, frontend and interpreter output used by the launcher. Startup
recomputes those hashes and refuses a stale or modified build. A startup failure reports
the server log; a successful HTTP response alone does not establish ownership.

Committed live captures also identify the environment that produced them. Set
`ZEPPELIN_E2E_SOURCE_COMMIT` to the exact checkout commit used to run the capture,
and `ZEPPELIN_E2E_BASE_COMMIT` to its exact `origin/master` base. The fixture records
both commits, the build-manifest identity and relative artifact hashes, the browser name and version, the
explicit loopback origin and port, the capture mode, authentication mode,
interpreter configuration, and the isolated notebook, search index, log, pid, and
recovery directories. Directory values are sanitized relative to `<capture-root>`
before the fixture is committed. Validation rejects a live capture when any of this
provenance is missing. The committed manifest data contains no checkout path.

The capture root and repository paths must not contain whitespace, including in
physical paths reached through symlinks. The Zeppelin launcher splits JVM arguments
on whitespace; the capture script rejects these paths before creating files or
launching a process. Choose a root and checkout without spaces, tabs or newlines.
Start and stop hold an atomic `.capture-operation-lock` in the capture root until the
operation completes. A concurrent operation fails. If an operation is killed with
SIGKILL, inspect its processes before removing a leftover lock or `starting` claim;
the script does not guess that another operation's lock is stale.

Live capture uses the same dedicated config with an explicit `PLAYWRIGHT_BASE_URL`
and zero retries. Dedicated anonymous/auth fixture capture logs in through the isolated
server's REST API and does not run the Angular global login setup. The tests delete only
the notes they create, in `finally` blocks; neither mode invokes shared API cleanup.
`CI=true` disables screenshots and video. Point the login helper at the capture root even in anonymous
mode: its absent `shiro.ini` prevents fallback to unrelated repository credentials.
Browser results use a unique temporary run directory and do not overwrite the ordinary
suite's test results. Generic live runs keep their auth snapshot there as
`.auth/user.json`; dedicated anonymous/auth capture does not create one. Set
`ZEPPELIN_CORE_CONTRACT_RUN_DIR` to keep results in a chosen capture directory; use a
different directory for each concurrent run and remove it when its artifacts are no
longer needed.

The server discards inherited `ZEPPELIN_*` settings, JVM option variables
(`JAVA_OPTS`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS`) and `CLASSPATH`.
It selects local `VFSNotebookRepo` storage by default and loopback binding, so a shell's
remote notebook configuration cannot redirect capture writes. Pass `--storage git` for
revision scenarios; this selects local `GitNotebookRepo` in the same isolated notebook
directory. `JAVA_HOME` and `PATH` still select the installed toolchain.

```bash
CAPTURE_ROOT="$(mktemp -d)"
BUILD_ROOT=/path/to/clean-origin-master-checkout
BUILD_MANIFEST="$(mktemp)"
node e2e/core-contract/capture-build-manifest.mjs create "${BUILD_MANIFEST}" "${BUILD_ROOT}"
e2e/core-contract/capture-server.sh start --root "${CAPTURE_ROOT}" --storage git --port 18080 \
  --build-root "${BUILD_ROOT}" --build-manifest "${BUILD_MANIFEST}"
ZEPPELIN_E2E_SHIRO_INI="${CAPTURE_ROOT}/conf/shiro.ini" \
  ZEPPELIN_E2E_BUILD_MANIFEST="${BUILD_MANIFEST}" \
  ZEPPELIN_E2E_SOURCE_COMMIT="$(git -C "${BUILD_ROOT}" rev-parse HEAD)" \
  ZEPPELIN_E2E_BASE_COMMIT="$(git -C "${BUILD_ROOT}" rev-parse origin/master)" \
  ZEPPELIN_CORE_CONTRACT_RUN_DIR="${CAPTURE_ROOT}/browser" \
  CI=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:18080 npm run e2e:core-contract:live
e2e/core-contract/capture-server.sh stop --root "${CAPTURE_ROOT}"
```

Execution fixtures use a named `sh` interpreter and pin the server-side streaming
switch explicitly. Start one isolated server for each value; do not rewrite the
setting in a running server:

```bash
e2e/core-contract/capture-server.sh start --root "${CAPTURE_ROOT}" --port 18080 \
  --paragraph-status-progress true --build-root "${BUILD_ROOT}" --build-manifest "${BUILD_MANIFEST}"
ZEPPELIN_CAPTURE_EXPECT_STREAMING=true \
  ZEPPELIN_WRITE_EXECUTION_FIXTURES=1 \
  ZEPPELIN_E2E_SHIRO_INI="${CAPTURE_ROOT}/conf/shiro.ini" \
  ZEPPELIN_E2E_BUILD_MANIFEST="${BUILD_MANIFEST}" \
  ZEPPELIN_E2E_SOURCE_COMMIT="$(git -C "${BUILD_ROOT}" rev-parse HEAD)" \
  ZEPPELIN_E2E_BASE_COMMIT="$(git -C "${BUILD_ROOT}" rev-parse origin/master)" \
  ZEPPELIN_CORE_CONTRACT_RUN_DIR="${CAPTURE_ROOT}/browser" \
  CI=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:18080 npm run e2e:core-contract:live
e2e/core-contract/capture-server.sh stop --root "${CAPTURE_ROOT}"
```

Repeat with a new capture root, `--paragraph-status-progress false`, and
`ZEPPELIN_CAPTURE_EXPECT_STREAMING=false` for the disabled fixture. The live
execution scenario skips with a named missing-interpreter reason if `sh` is not
installed; that result is not evidence that the fixture scenario passed.

For authenticated capture, add `--mode auth` to start. That installs
`shiro.ini.template` in the capture root; the same `ZEPPELIN_E2E_SHIRO_INI` setting
selects it. The helper wiring and a successful authenticated capture are separate
checks. `capture-auth-error-fixtures.sh` enforces both modes and writes each recorder's
sanitized output below the supplied root:

```bash
CAPTURE_ROOT="$(mktemp -d)"
npm run capture:core-contract-auth-errors -- --root "${CAPTURE_ROOT}" --port 18080 \
  --build-root "${BUILD_ROOT}" --build-manifest "${BUILD_MANIFEST}"
```

The live cases capture anonymous and authenticated ACL GET/PUT responses, an explicit
logout REST 401, non-logout and logout-URL REST 405 responses, and an ACL-driven
`AUTH_INFO`. A checkpoint request on a note with no revision safely captures the
server's global `ERROR_INFO` path. The session matrix is backed by four separate recorder fixtures: HTTP-only
405, HTTP 405 followed by a command on the existing ticket, explicit logout followed by
the server's no-response behavior for the removed ticket, and an old-ticket
`SESSION_LOGOUT` after a full isolated-server stop/start and replacement login. The
orchestrator removes its temporary raw ticket state and stops both server processes.
Every generated fixture records `captureSource: capture-server.sh`; the restart fixture
also records `capturePhase: after-server-restart`. The committed copies contain only
recorder output, and tests replay all four lifecycle fixtures and reject missing
provenance or secrets.

Cases the isolated server cannot produce safely carry a specific `knownExclusions`
entry: the other 401 `Location` variant and the browser-only missing-response-URL
guard. Those host behaviors remain covered by interceptor unit tests and are not
counted as captured events. The client-side principal-only `isOwner` display
shortcut is not used as a server authorization rule.
`npm run check:core-contract-auth` runs a browser-backed anonymous setup regression
in a disposable directory and verifies that the ordinary auth snapshot is preserved.
It requires installed Chromium but no Zeppelin server; the Node-only fixture check
skips this browser regression.

Replay is strict about what it answers: a request no remaining record can answer, a
WebSocket frame that does not match the next recorded one, and any record left
unconsumed all fail the test. The limits of that strictness are in "What version 1
does not model". Maven runs the format checks in its test phase and the capture-server checks
in integration-test. The browser tests are part of the ordinary e2e suite, so they
run wherever it does. Live capture remains outside the ordinary suite: its cases are
tagged `@live` and run only through `npm run e2e:core-contract:live` or the two-mode
capture command above.

These checks prove fixture shape and adapter transport behavior. Separate E2E
scenarios must cover a running Zeppelin server, authorization, collaboration,
reconnection, interpreter execution, streaming output, performance, and
accessibility.

### Notebook route boundary proof

`npm run build:notebook-core-port-proof` builds the React consumer and Angular
route host separately. `npm run test:notebook-route-boundary` then checks the
current `/notebook/:noteId` and `/notebook/:noteId/revision/:revisionId` route
shapes in Chromium. The proof bootstraps the production `WorkspaceModule` lazy
route, follows its `NotebookModule` lazy route, and asserts that the activated
component is the production `NotebookComponent`. Its browser-only message-service
double records the production component's `getNote`, `noteRevision`, and revision
history requests. The Angular harness reads the resulting activated-route snapshot
into one host-owned test Core; the remote receives only its stable
`NotebookCorePort`, reads the selected note and revision snapshot, and observes
route-driven subscription updates. The browser assertion records the two production
paths explicitly, so a route-shape change requires an intentional proof update. The
Maven test phase runs the build and both browser proofs in the normal browser CI job.

This proof leaves the physical WebSocket connect, close and reconnect lifecycle,
the SDK, and Angular services with the shell. Future Core work owns note
re-subscription and state recovery only after stale uncorrelated replies have an
enforceable rejection mechanism. The harness does not implement those lifecycle
rules, switch the production renderer, or move production notebook state out of
Angular.

### How a replay reports failure

The Playwright adapter reports a broken fixture by rejecting the route handler, which
Playwright surfaces as an unhandled error and attributes to the running test. A route
whose key no remaining record can answer is rejected immediately. A route that is
merely waiting is not: the fixture cannot tell "the page has not sent that request
yet" from "the page will never send it", so that case is left to Playwright's own
test timeout.

## Capturing safely

`createNotebookTransportRecorder(metadata)` records `/api/notebook`, `/api/login`, and
`/api/login/logout` REST traffic plus `/ws` frames. It redacts configured sensitive and
volatile fields before it writes a fixture. JSON WebSocket frames are normalized and redacted;
binary frames are rejected during capture until a binary redaction policy is
implemented. Replay still supports deliberately authored binary fixtures for
protocol-level tests.
Each WebSocket record must contain exactly one of `payloadText` and `payloadBase64`;
validation rejects records with both representations.

A notebook request still awaiting a response when `stop()` or `write()` is called
fails the capture, as does a failed request. Await scenario completion before stopping.
`validateFixture` also rejects request records without a matching response, so an
incomplete hand-authored fixture fails validation before replay.

### Which identifiers are normalized, and which are kept

Timestamp fields `dateCreated`, `dateStarted`, `dateFinished`, `dateUpdated`,
`lastUpdated` and `time` are replaced by placeholders. Timing-dependent scenarios
remain outside v1.

WebSocket envelope `msgId` is a correlation key: Angular uses the echoed ID to focus
a locally inserted or cloned paragraph. Capture assigns distinct stable placeholders
such as `<msgId:1>` and preserves repeated references to each ID. Replay binds these
to IDs actually sent by the client and substitutes the live ID in matching responses.
It rejects inconsistent or reused bindings. Legacy fixtures containing the erased
`<msgId>` envelope value must be recaptured because their identity relationships
cannot be recovered. Non-envelope `msgId` fields retain the generic normalization rule.

Names that carry a person are masked the same way, by field name only: `user`, which is
what Zeppelin calls the acting principal on a paragraph, the `owners`, `readers`,
`writers` and `runners` that `/api/notebook/{id}/permissions` answers with, the `users` a
`COLLABORATIVE_MODE_STATUS` frame lists while more than one session has the note open,
and `roles`. Without them
an authenticated capture would write whoever took it, and whoever else can reach the
note, into the fixture. A permission set is masked entry by entry, so the array keeps its
shape and its count. The text rules leave `user=` and `owners=` alone, because both are
ordinary in a url and in note text.

`noteId` and `paragraphId` are kept as captured, preserving references across URLs,
bodies and frames. This is a v1 reproducibility tradeoff: recapturing the same flow
can produce a different file. A future bijective ID mapping could remove that churn
without losing references; it is not required for replaying one captured trace.

They are stable within a fixture but not between captures, and a Zeppelin paragraph id
carries the creation time in it (`paragraph_1757...`), so re-capturing a scenario
produces a textually different fixture even when the contract has not changed. A future
version could map each id to a numbered placeholder consistently and get diff-clean
re-captures without losing the reference; version 1 does not, and a re-capture is
reviewed as a new recording rather than as a diff.

### What redaction reaches, and what it does not

Redaction acts on field names first. A name counts as sensitive when one of its words
is a sensitive word, or when it ends in one, or - for a name written in one uppercase
run, as environment variables are - when it merely contains one. Names are split on
separators and on camel case, so `accessToken`, `secretKey`, `aws_secret_access_key`,
`spark.hadoop.fs.s3a.secret.key`, `x-api-key`, `PGPASSWORD`, `SECRETKEY`,
`private_key` and `passphrase` all count, while `tokenizer`, `secretary`, `tokens`,
`max_tokens`, `privately` and `keyboard` do not. A name outside the list is not masked
- `pwd`, `bearer` and `sessionId` are not - so add the word rather than relying on the
shape of the value. A name in mixed case with no separator, such as `SECRETkey`, falls
between the rules and is missed.

Two fields carry no inner structure for that to work on, and only those two are
scanned as text: `url`, whose credential sits in the query under no name of its own,
and `bodyRaw`, which arrives as one opaque string. There the rules look for
`name=value` and `name: value`, a url's `user:password@host`, and a header credential
that runs to the end of its line.

A WebSocket frame picks its own treatment. A frame that parses as JSON is redacted by
key, like any other record; a frame that does not is text-scanned as one string, the
same way `bodyRaw` is. Scanning the JSON as text on top of the key pass would rewrite
the note inside it and leave a capture the fixture could no longer replay.

**Everything else keeps its text.** A json field, and a string inside an array, are
covered by the name they sit under, so the value is left as written. This is deliberate: the text rules cannot tell a credential
from prose that mentions one, and a note is full of prose that does. Scanning note
text rewrote `ticketCount = df.count()`, `SELECT ... WHERE ticket_id = 42` and
`const cookieBanner = document.getElementById("x")`, which is a worse outcome for a
fixture than the narrow gap it closed. The capture helper starts an isolated, empty
server for the same reason: a fixture's note text is written by the test that captured
it, not by whoever owns the machine.

What the text rules still do not reach, where they do scan: an unquoted
value containing a space keeps its tail; a `name: value` pair is only matched where the
name opens an unindented line, a quoted string, an object or a JSON array entry, so an
indented yaml key and a `- ` list item are left as written; a url's userinfo is only
matched in its `user:password@host` form, so `token@host` is left alone; a name and its
value split across two fields, as in `{"name": "password", "value": "hunter2"}`, has no
name beside the value to match on; `password==abc` is read as a comparison rather than
an assignment; and a credential that carries no name at all - a bare token, a base64
blob - is invisible to every rule here.

In text a purely numeric value is left alone for names ending in `principal`, because
that word is also an accounting term. A field named `principal` is masked whatever it
holds.

Do not rely on any of this for a fixture captured from a server holding real
credentials. Capture from the isolated server this directory starts.
