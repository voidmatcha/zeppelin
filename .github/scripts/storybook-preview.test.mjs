/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePreview, validateStorybook } from "./storybook-preview.mjs";

const repository = "apache/zeppelin";
const sha = "a".repeat(40);

function fixture() {
  const pr = {
    number: 5562,
    state: "open",
    base: { repo: { full_name: repository } },
    head: {
      ref: "assistant-v2-4-storybook",
      sha,
      repo: { full_name: "contributor/zeppelin" },
    },
  };
  const run = {
    id: 123,
    repository: { full_name: repository },
    path: ".github/workflows/storybook.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    head_branch: pr.head.ref,
    head_repository: { ...pr.head.repo },
    pull_requests: [],
  };
  const access = { permission: "write" };
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path.endsWith("/actions/runs/123")) return run;
    if (path.includes("/pulls?")) return [pr];
    if (path.endsWith("/collaborators/contributor/permission")) return access;
    throw new Error(`Unexpected API path: ${path}`);
  };
  return { pr, run, access, calls, resolve: () => resolvePreview({ repository, runId: 123, api }) };
}

test("publishes the current writer-owned fork head with no run PR association", async () => {
  const f = fixture();
  assert.deepEqual(await f.resolve(), {
    number: 5562,
    sha,
    target: "storybook/pr-5562",
  });
  assert.ok(f.calls.some((path) => path.includes("head=contributor%3Aassistant-v2-4-storybook")));
});

for (const [name, change] of [
  ["stale PR head", (f) => { f.pr.head.sha = "b".repeat(40); }],
  ["wrong PR repository", (f) => { f.pr.head.repo.full_name = "attacker/zeppelin"; }],
  ["wrong base repository", (f) => { f.pr.base.repo.full_name = "attacker/zeppelin"; }],
  ["wrong run repository", (f) => { f.run.repository.full_name = "attacker/zeppelin"; }],
  ["wrong workflow", (f) => { f.run.path = ".github/workflows/other.yml"; }],
  ["push event", (f) => { f.run.event = "push"; }],
  ["failed build", (f) => { f.run.conclusion = "failure"; }],
  ["closed PR", (f) => { f.pr.state = "closed"; }],
  ["wrong branch", (f) => { f.pr.head.ref = "other"; }],
  ["read-only owner", (f) => { f.access.permission = "read"; }],
  ["triage-only owner", (f) => { f.access.permission = "triage"; }],
]) {
  test(`rejects ${name}`, async () => {
    const f = fixture();
    change(f);
    assert.equal(await f.resolve(), null);
  });
}

test("rejects ambiguous matching pull requests", async () => {
  const f = fixture();
  const api = async (path) =>
    path.includes("/pulls?") ? [f.pr, f.pr] :
    path.endsWith("/actions/runs/123") ? f.run : f.access;
  assert.equal(await resolvePreview({ repository, runId: 123, api }), null);
});

async function artifact(t) {
  const dir = await mkdtemp(join(tmpdir(), "zeppelin-storybook-preview-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Storybook</title>");
  await writeFile(
    join(dir, "index.json"),
    JSON.stringify({ entries: { demo: { type: "story" } } }),
  );
  return dir;
}

test("accepts a regular Storybook artifact", async (t) => {
  const dir = await artifact(t);
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "bundle.js"), "static data");
  await validateStorybook(dir);
});

for (const content of [
  "---\npermalink: /index.html\n---\n",
  "--- \npermalink: /index.html\n---\n",
  "\uFEFF---\r\npermalink: /index.html\r\n---\r\n",
]) {
  test("rejects Jekyll front matter in any artifact file", async (t) => {
    const dir = await artifact(t);
    await writeFile(join(dir, "asset.html"), content);
    await assert.rejects(validateStorybook(dir), /front matter/);
  });
}

test("rejects Jekyll control paths", async (t) => {
  const dir = await artifact(t);
  await writeFile(join(dir, "_config.yml"), "permalink: /index.html");
  await assert.rejects(validateStorybook(dir), /control paths/);
});

test("rejects symlinks", async (t) => {
  const dir = await artifact(t);
  await symlink(join(dir, "index.html"), join(dir, "asset.html"));
  await assert.rejects(validateStorybook(dir), /symlinks/);
});

test("rejects missing stories", async (t) => {
  const dir = await artifact(t);
  await writeFile(join(dir, "index.json"), '{"entries":{}}');
  await assert.rejects(validateStorybook(dir), /contain a story/);
});
