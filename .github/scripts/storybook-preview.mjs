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

import { appendFile, lstat, readdir, readFile, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[a-f0-9]{40}$/i;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const STORYBOOK_WORKFLOW = ".github/workflows/storybook.yml";

export async function resolvePreview({ repository, runId, api }) {
  if (!REPOSITORY.test(repository) || !/^\d+$/.test(String(runId))) {
    throw new Error("Invalid repository or run ID");
  }
  const root = `repos/${repository}`;
  const run = await api(`${root}/actions/runs/${runId}`);
  if (
    String(run.id) !== String(runId) ||
    run.repository?.full_name !== repository ||
    run.path?.split("@")[0] !== STORYBOOK_WORKFLOW ||
    run.event !== "pull_request" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !SHA.test(run.head_sha ?? "") ||
    !REPOSITORY.test(run.head_repository?.full_name ?? "") ||
    !run.head_branch
  ) {
    return null;
  }

  const owner = run.head_repository.full_name.split("/")[0];
  const head = encodeURIComponent(`${owner}:${run.head_branch}`);
  const candidates = await api(`${root}/pulls?state=open&head=${head}&per_page=100`);
  const matches = candidates.filter(
    (pr) =>
      Number.isSafeInteger(pr.number) &&
      pr.number > 0 &&
      pr.state === "open" &&
      pr.base?.repo?.full_name === repository &&
      pr.head?.repo?.full_name === run.head_repository.full_name &&
      pr.head?.ref === run.head_branch &&
      pr.head?.sha === run.head_sha,
  );
  if (matches.length !== 1) return null;

  // PR HTML will be served from apache.github.io. Only repository writers may
  // cause their fork's code to be published under that origin.
  const access = await api(`${root}/collaborators/${owner}/permission`);
  if (!["write", "maintain", "admin"].includes(access.permission)) return null;

  return {
    number: matches[0].number,
    sha: run.head_sha,
    target: `storybook/pr-${matches[0].number}`,
  };
}

export async function validateStorybook(directory) {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory()) {
    throw new Error("Artifact root must be a directory");
  }
  let files = 0;
  let bytes = 0;
  async function walk(path) {
    for (const name of await readdir(path)) {
      if (name.startsWith(".") || name.startsWith("_")) {
        throw new Error("Jekyll control paths are forbidden in the artifact");
      }
      const file = join(path, name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error("Artifact symlinks are forbidden");
      if (stat.isDirectory()) {
        await walk(file);
      } else if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
        if (files > 10000 || bytes > 200 * 1024 * 1024) {
          throw new Error("Artifact exceeds size limits");
        }
        const handle = await open(file, "r");
        try {
          const prefix = Buffer.alloc(12);
          const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
          if (/^(?:\uFEFF)?---/.test(prefix.subarray(0, bytesRead).toString("utf8"))) {
            throw new Error("Jekyll front matter is forbidden in the artifact");
          }
        } finally {
          await handle.close();
        }
      } else {
        throw new Error("Artifact must contain only regular files and directories");
      }
    }
  }
  await walk(root);
  for (const name of ["index.html", "index.json"]) {
    if (!(await lstat(join(root, name))).isFile()) {
      throw new Error(`Missing regular ${name}`);
    }
  }
  const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
  if (
    !index.entries ||
    typeof index.entries !== "object" ||
    Array.isArray(index.entries) ||
    !Object.values(index.entries).some((entry) => entry?.type === "story")
  ) {
    throw new Error("Storybook index must contain a story");
  }
}

async function main() {
  const [mode, directory] = process.argv.slice(2);
  if (mode === "validate" && directory) return validateStorybook(directory);
  if (mode !== "resolve") throw new Error("Usage: storybook-preview.mjs resolve | validate DIR");
  const { GITHUB_REPOSITORY, GITHUB_OUTPUT, GH_TOKEN, RUN_ID } = process.env;
  if (!GH_TOKEN || !GITHUB_OUTPUT) throw new Error("Missing GitHub token or output path");
  const api = async (path) => {
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`);
    return response.json();
  };
  const preview = await resolvePreview({
    repository: GITHUB_REPOSITORY,
    runId: RUN_ID,
    api,
  });
  await appendFile(
    GITHUB_OUTPUT,
    preview
      ? `publish=true\nnumber=${preview.number}\nsha=${preview.sha}\ntarget=${preview.target}\n`
      : "publish=false\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
