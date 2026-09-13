#!/usr/bin/env bash
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

usage() {
  echo "usage: $0 --root <dir> --build-root <dir> --build-manifest <file> [--port <anonymous-port>]" >&2
}

capture_root=""
anonymous_port="18080"
build_root=""
build_manifest=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      capture_root="${2:-}"
      shift 2
      ;;
    --port)
      anonymous_port="${2:-}"
      shift 2
      ;;
    --build-root)
      build_root="${2:-}"
      shift 2
      ;;
    --build-manifest)
      build_manifest="${2:-}"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${capture_root}" || -z "${build_root}" || -z "${build_manifest}" || ! "${anonymous_port}" =~ ^[0-9]+$ ]]; then
  usage
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../../.." && pwd -P)"
build_root="$(cd "${build_root}" && pwd -P)"
source_commit="$(git -C "${build_root}" rev-parse HEAD)"
base_commit="$(git -C "${build_root}" rev-parse origin/master)"
if ! git -C "${build_root}" merge-base --is-ancestor "${base_commit}" "${source_commit}"; then
  echo "capture checkout ${source_commit} is not based on origin/master ${base_commit}" >&2
  exit 1
fi
if [[ -n "$(git -C "${repo_root}" status --porcelain --untracked-files=no)" ]]; then
  echo "capture harness checkout must have no tracked changes" >&2
  exit 1
fi
manifest_script="${repo_root}/zeppelin-web-angular/e2e/core-contract/capture-build-manifest.mjs"
node "${manifest_script}" verify "${build_manifest}" "${build_root}"
server_script="${repo_root}/zeppelin-web-angular/e2e/core-contract/capture-server.sh"
fixture_output="${capture_root}/captured"
lifecycle_state="${capture_root}/restart-ticket.json"
active_root=""

stop_active_server() {
  if [[ -n "${active_root}" ]]; then
    "${server_script}" stop --root "${active_root}"
    active_root=""
  fi
}
cleanup() {
  local command_status="$?"
  local stop_status=0
  trap - EXIT INT TERM
  set +e
  stop_active_server || stop_status="$?"
  rm -f "${lifecycle_state}"
  if [[ "${command_status}" -ne 0 ]]; then
    exit "${command_status}"
  fi
  exit "${stop_status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_capture() {
  local browser_mode="$1"
  local server_mode="$2"
  local mode_root="$3"
  local port="$4"
  active_root="${mode_root}"
  "${server_script}" start --root "${mode_root}" --mode "${server_mode}" --port "${port}" \
    --build-root "${build_root}" --build-manifest "${build_manifest}"
  (
    cd "${repo_root}/zeppelin-web-angular"
    ZEPPELIN_E2E_CAPTURE_MODE="${browser_mode}" \
      ZEPPELIN_E2E_FIXTURE_OUTPUT_DIR="${fixture_output}" \
      ZEPPELIN_E2E_SHIRO_INI="${mode_root}/conf/shiro.ini" \
      ZEPPELIN_E2E_LIFECYCLE_STATE="${lifecycle_state}" \
      ZEPPELIN_E2E_BASE_COMMIT="${base_commit}" \
      ZEPPELIN_E2E_BUILD_MANIFEST="${build_manifest}" \
      ZEPPELIN_E2E_SOURCE_COMMIT="${source_commit}" \
      ZEPPELIN_CORE_CONTRACT_RUN_DIR="${mode_root}/browser" \
      PLAYWRIGHT_BASE_URL="http://127.0.0.1:${port}" \
      CI=true \
      npm run e2e:core-contract:live
  )
  stop_active_server
}

mkdir -p "${fixture_output}"
auth_root="${capture_root}/auth"
run_capture anonymous anonymous "${capture_root}/anonymous" "${anonymous_port}"
run_capture auth auth "${auth_root}" "$((anonymous_port + 1))"
if [[ ! -s "${lifecycle_state}" ]]; then
  echo "auth capture did not write restart lifecycle state" >&2
  exit 1
fi
lifecycle_mode="$(stat -f '%Lp' "${lifecycle_state}" 2>/dev/null || stat -c '%a' "${lifecycle_state}")"
if [[ "${lifecycle_mode}" != "600" ]]; then
  echo "restart lifecycle state must be owner-only, got mode ${lifecycle_mode}" >&2
  exit 1
fi
# Reuse the isolated root and port only after a full stop/start cycle. This preserves
# notebook storage while replacing the in-memory TicketContainer.
run_capture auth-restart auth "${auth_root}" "$((anonymous_port + 1))"
echo "captured auth fixtures: ${fixture_output}"
