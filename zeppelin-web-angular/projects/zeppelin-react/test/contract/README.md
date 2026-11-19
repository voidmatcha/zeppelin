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
or introducing a code generation framework.

From the repository root, with the project's JDK and frontend dependencies installed:

```sh
rm -f zeppelin-server/target/assistant-contract/wire.json
./mvnw package -pl zeppelin-server --am -Dtest=AssistantWireContractTest -Dsurefire.failIfNoSpecifiedTests=false
cd zeppelin-web-angular
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
Fields the consumer ignores are deliberately outside this check.
