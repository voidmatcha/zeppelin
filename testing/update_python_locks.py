# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements. See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Refresh, or check, the committed Linux Python environment locks.

Without arguments, re-solve every lock in testing/locks/. With --check, only
verify that each lock's content hash matches its dependency definitions; this
does not run a solver.
"""

import argparse
from pathlib import Path, PurePosixPath
import subprocess
import sys

import yaml

REFRESH_COMMAND = "python testing/update_python_locks.py"


def find_locks():
    locks = sorted(Path("testing/locks").glob("*.conda-lock.yml"))
    if not locks:
        raise SystemExit(
            "No Python environment locks found; run from the repository root"
        )
    return locks


def load_lock(lock):
    with lock.open(encoding="utf-8") as source:
        return yaml.safe_load(source)


def source_files(lock, metadata):
    """Return the definitions recorded in a lock, failing if any are absent."""
    sources = metadata.get("sources") or []
    if not sources:
        raise SystemExit(f"{lock} does not record its source files")
    paths = [lock.parent / PurePosixPath(source) for source in sources]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise SystemExit(f"{lock} refers to missing source files: {missing}")
    return paths


def check(locks):
    # conda-lock does not offer a public, solver-free hash check, so reuse the
    # functions that `conda-lock lock` uses to compute metadata.content_hash.
    from conda_lock.content_hash import compute_content_hashes
    from conda_lock.lookup import DEFAULT_MAPPING_URL
    from conda_lock.src_parser import make_lock_spec
    from conda_lock.virtual_package import default_virtual_package_repodata

    # Matches the --without-cuda option used for refreshes.
    virtual_packages = default_virtual_package_repodata(cuda_version="")
    stale = []
    for lock in locks:
        metadata = load_lock(lock)["metadata"]
        spec = make_lock_spec(
            src_files=source_files(lock, metadata),
            platform_overrides=metadata["platforms"],
            mapping_url=DEFAULT_MAPPING_URL,
        )
        expected = compute_content_hashes(spec, virtual_packages)
        if expected != metadata["content_hash"]:
            stale.append(lock)
            print(f"::error file={lock}::{lock} is stale: its dependency "
                  "definitions changed after it was generated")
        else:
            print(f"{lock} matches its dependency definitions")
    if stale:
        raise SystemExit(
            f"{len(stale)} Python environment lock(s) do not match testing/envs/. "
            f"Regenerate them with `{REFRESH_COMMAND}` or the Python dependency "
            "refresh workflow, and commit the changed locks. See testing/README.md."
        )


def refresh(locks):
    for lock in locks:
        content = load_lock(lock)
        command = [
            sys.executable, "-m", "conda_lock", "lock", "--no-mamba",
            "--without-cuda", "--platform", "linux-64",
            "--lockfile", str(lock),
        ]
        # Pass the definitions explicitly so that conda-lock never falls back
        # to a default environment.yml.
        for path in source_files(lock, content["metadata"]):
            command.extend(["-f", str(path)])
        # Conda solves afresh; explicitly update pip packages that Poetry
        # would otherwise retain from the previous lock.
        pip_packages = {
            package["name"]
            for package in content["package"]
            if package["manager"] == "pip"
        }
        for name in sorted(pip_packages):
            command.extend(["--update", name])
        subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check", action="store_true",
        help="verify that the locks match their definitions without solving",
    )
    args = parser.parse_args()
    locks = find_locks()
    if args.check:
        check(locks)
    else:
        refresh(locks)


if __name__ == "__main__":
    main()
