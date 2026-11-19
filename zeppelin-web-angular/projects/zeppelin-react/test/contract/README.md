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

# Assistant wire contract PoC

This check connects Java provider output to the actual TypeScript REST adapter
and WebSocket mapper, without committing a handwritten copy of server fixtures
or introducing a code generation framework.

From the repository root, with the project's JDK and frontend dependencies installed:

```sh
rm -f zeppelin-server/target/assistant-contract/wire.json
./mvnw package -pl zeppelin-server --am -Dtest=AssistantWireContractTest -Dsurefire.failIfNoSpecifiedTests=false
cd zeppelin-web-angular
npm run check:assistant-contract
```

CI runs both steps on the anonymous frontend job. The Java test uses production
`JsonResponse` and `NotebookServer.serializeMessage` serializers. Output stays
under Maven's `target` directory and is regenerated rather than committed.
A missing fixture fails the consumer check. For another output path, set Maven's
`assistant.contract.output` property and the consumer's
`ASSISTANT_CONTRACT_FIXTURE` environment variable to the same absolute path.

The consumer validates the fields it uses before sorting or rendering responses.
Server-owned metadata and run identifiers are required. An omitted history cursor
means no earlier page. Message content may be absent or null for tool-only turns.
Additive fields remain compatible. UI types remain separate from wire data and
may have different optional fields.

Checks cover owner/reader permissions, default titles, history ordering,
tool-only messages, cursor omission, and all seven current event types.
Negative checks remove required fields or change their types.

This checks serialization and consumer compatibility. It does not prove endpoint
authorization, request routing, socket delivery, LLM behavior, or concurrency.
Hand-selected DTO examples need extending for new variants and event types.
Fields the consumer ignores are deliberately outside this check.

Related approaches investigated:

- [Apache Superset's API spec drift CI](https://github.com/apache/superset/blob/69e1cd3a879ac22fdb2ba85df786078370cc32ae/.github/workflows/check-openapi-spec-drift.yml)
  regenerates its OpenAPI spec and fails on differences. This PoC generates wire
  examples instead of introducing OpenAPI across Zeppelin.
- [Spring Cloud Contract's official producer sample](https://github.com/spring-cloud-samples/spring-cloud-contract-samples/blob/0df8bfb616fa0bc3ff667dd2c3c1ea6a528b71be/producer/pom.xml)
  configures provider verification and generated contract tests. It is a sample,
  rather than evidence of a production deployment. This PoC adds no dependency
  on its contract framework.
