<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements. See the NOTICE file
distributed with this work for additional information
regarding copyright ownership. The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied. See the License for the
specific language governing permissions and limitations
under the License.
-->

# Assistant provider and consumer contract

This check connects Java provider output to the actual TypeScript REST adapter
and WebSocket run transport, without committing a handwritten copy of server fixtures
and uses OpenAPI 3.1 for all six Assistant REST operations.

From the repository root, with the project's JDK and frontend dependencies installed:

```sh
rm -rf zeppelin-server/target/assistant-contract
./mvnw package -pl zeppelin-server --am -Dtest=AssistantWireContractTest,AssistantOpenApiContractTest -Dsurefire.failIfNoSpecifiedTests=false
cd zeppelin-web-angular
npm run generate:assistant-rest-types # after an intentional REST contract change
npm run check:assistant-contract
```

CI runs both steps on the anonymous frontend job. The Java test uses production
`JsonResponse`, the production `NotebookServer.sendAssistantMessage` handler,
and its WebSocket serializer. A scripted `ChatModel` also drives `AssistantImpl`
through a tool round and final answer, persisted through `FileConversationRepository`. Output stays
under Maven's `target` directory and is regenerated rather than committed.
A missing fixture fails the consumer check. For another output path, set Maven's
`assistant.contract.output` property and the consumer's
`ASSISTANT_CONTRACT_FIXTURE` environment variable to the same absolute path.

The consumer validates the fields it uses before sorting or rendering responses.
Conversation identity, permission, ownership, and run identifiers are required.
Missing/null display titles normalize to an empty string for the existing
untitled-label fallback. Missing/null activity times use the required creation
time; supplied values of the wrong type are rejected. An omitted history cursor
means no earlier page. Message content may be absent or null for tool-only turns.
Additive fields remain compatible. UI types remain separate from wire data and
may have different optional fields.

Checks cover owner/reader permissions, default titles, history ordering,
tool-only messages, cursor omission, all seven current event types, socket
conversation routing, terminal cleanup, and stored sparse display metadata.
Negative checks remove required fields or change their types.

This checks serialization and consumer compatibility. It does not prove endpoint
authorization, socket network delivery, real-provider LLM behavior, or concurrency.
Hand-selected DTO examples need extending for new variants and event types.
The OpenAPI check additionally validates documented fields the UI does not use.

## REST schema generation

Swagger Core reads the two Assistant JAX-RS resources during tests. A field-based
resolver avoids bean getters; response examples use the real resource methods
and `JsonResponse` serialization. Required properties are explicit guarantees,
not inferred from Java reference types. Persisted message timestamps and tool
arguments can be absent. Creating a conversation accepts an omitted or null title;
renaming requires a nonblank string.

`openapi-typescript` generates the SDK's `assistant-rest.generated.ts`. UI models
reuse those types while preserving their normalization rules. CI regenerates the
OpenAPI document, compares generated TypeScript with the committed file, and
validates resource success statuses and entities with Ajv. Both schema checks and
the consumer allow additive fields. Positive controls add
unknown fields to actual resource envelopes and payloads. Optional field removal
or renaming may remain schema-valid, so schema validation alone cannot prove that
the UI preserves every optional value. Gson-specific field naming and custom
adapters require corresponding schema definitions and consumer expectations.
Consumer request checks cover the four operations exposed
by the current React adapter, including their routes, methods and JSON bodies.

This is a success-payload and structural contract, not a complete behavioral spec.
For example, runtime `String.isBlank` validation is stronger than the rename
schema's `minLength`, and Gson may coerce primitive request values. Error response
bodies, security schemes, routing through Jersey, CORS, and all other Zeppelin REST
resources are outside this initial scope. Business validation and authorization
still belong to server tests. OpenAPI does not describe WebSocket events; the
existing producer/consumer event checks remain separate and run in the same job.

The schema generator and scanner are test-only. Production adds annotations but
no scanner, documentation endpoint, generated HTTP client, or runtime validator.
