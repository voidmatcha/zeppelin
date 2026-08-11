#!/usr/bin/env bash
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

HADOOP_VERSION="${1:?Hadoop version is required}"
TARGET_ARCH="${2:-}"

detect_native_arch() {
  if command -v dpkg > /dev/null 2>&1; then
    dpkg --print-architecture
    return
  fi
  uname -m
}

if [[ -z "$TARGET_ARCH" ]]; then
  TARGET_ARCH="$(detect_native_arch)"
fi

case "$TARGET_ARCH" in
  amd64|x86_64)
    echo "hadoop-$HADOOP_VERSION.tar.gz"
    ;;
  arm64|aarch64)
    echo "hadoop-$HADOOP_VERSION-aarch64.tar.gz"
    ;;
  *)
    echo "Unsupported architecture: $TARGET_ARCH" >&2
    exit 1
    ;;
esac
