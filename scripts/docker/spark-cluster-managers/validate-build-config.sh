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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RESOLVER="$SCRIPT_DIR/spark_yarn_cluster/resolve-hadoop-archive.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

extract_xml_property() {
  local file="$1"
  local property="$2"
  sed -n "s/.*<$property>\\([^<][^<]*\\)<\\/$property>.*/\\1/p" "$file" | head -n 1
}

extract_arg_default() {
  local file="$1"
  local arg="$2"
  sed -n "s/^ARG $arg=\\([^[:space:]]*\\)$/\\1/p" "$file" | head -n 1
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$message: expected '$expected', got '$actual'"
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "$expected" "$file" || fail "$file does not contain: $expected"
}

run_with_fake_dpkg() {
  local dpkg_arch="$1"
  local target_arch="$2"
  local fake_bin
  fake_bin="$(mktemp -d "$TEMP_DIR/fake-dpkg.XXXXXX")"
  cat > "$fake_bin/dpkg" <<EOF
#!/usr/bin/env bash
echo "$dpkg_arch"
EOF
  chmod +x "$fake_bin/dpkg"
  PATH="$fake_bin:$PATH" "$RESOLVER" 3.3.6 "$target_arch"
}

[[ -x "$RESOLVER" ]] || fail "$RESOLVER is missing or is not executable"

assert_eq "$("$RESOLVER" 3.3.6 amd64)" "hadoop-3.3.6.tar.gz" \
  "BuildKit linux/amd64 should use the generic Hadoop archive"
assert_eq "$("$RESOLVER" 3.3.6 arm64)" "hadoop-3.3.6-aarch64.tar.gz" \
  "BuildKit linux/arm64 should use the aarch64 Hadoop archive"
assert_eq "$(run_with_fake_dpkg amd64 "")" "hadoop-3.3.6.tar.gz" \
  "Classic docker build on amd64 should use native package-manager architecture"
assert_eq "$(run_with_fake_dpkg arm64 "")" "hadoop-3.3.6-aarch64.tar.gz" \
  "Classic docker build on arm64 should use native package-manager architecture"
if "$RESOLVER" 3.3.6 s390x > "$TEMP_DIR/unsupported.out" 2>&1; then
  fail "unsupported BuildKit architecture should fail"
fi
if run_with_fake_dpkg ppc64el "" > "$TEMP_DIR/unsupported.out" 2>&1; then
  fail "unsupported classic docker build architecture should fail"
fi

SPARK_VERSION="$(extract_xml_property "$REPO_ROOT/spark/pom.xml" spark.version)"
SCALA_BINARY_VERSION="$(extract_xml_property "$REPO_ROOT/spark/pom.xml" spark.scala.binary.version)"
JAVA_VERSION="$(extract_xml_property "$REPO_ROOT/pom.xml" java.version)"
HADOOP_VERSION="$(extract_xml_property "$REPO_ROOT/pom.xml" hadoop.version)"

for dockerfile in \
  "$SCRIPT_DIR/spark_standalone/Dockerfile" \
  "$SCRIPT_DIR/spark_yarn_cluster/Dockerfile"; do
  assert_eq "$(extract_arg_default "$dockerfile" SPARK_VERSION)" "$SPARK_VERSION" \
    "$dockerfile SPARK_VERSION drifted from spark/pom.xml"
  assert_eq "$(extract_arg_default "$dockerfile" SCALA_VERSION)" "$SCALA_BINARY_VERSION" \
    "$dockerfile SCALA_VERSION drifted from spark/pom.xml"
  assert_eq "$(extract_arg_default "$dockerfile" JAVA_VERSION)" "$JAVA_VERSION" \
    "$dockerfile JAVA_VERSION drifted from pom.xml"
done

assert_eq "$(extract_arg_default "$SCRIPT_DIR/spark_yarn_cluster/Dockerfile" HADOOP_VERSION)" "$HADOOP_VERSION" \
  "spark_yarn_cluster Dockerfile HADOOP_VERSION drifted from pom.xml"
assert_contains "$SCRIPT_DIR/spark_yarn_cluster/Dockerfile" \
  "COPY resolve-hadoop-archive.sh /usr/local/bin/resolve-hadoop-archive"
assert_contains "$SCRIPT_DIR/spark_yarn_cluster/Dockerfile" \
  "RUN HADOOP_ARCHIVE=\"\$(resolve-hadoop-archive"

DOC="$REPO_ROOT/docs/setup/deployment/spark_cluster_mode.md"
assert_contains "$DOC" "Spark $SPARK_VERSION"
assert_contains "$DOC" "Scala $SCALA_BINARY_VERSION"
assert_contains "$DOC" "Hadoop $HADOOP_VERSION"
assert_contains "$DOC" "BuildKit builds set \`TARGETARCH\` automatically."
assert_contains "$DOC" "Classic \`docker build\` detects the native package-manager architecture inside the image."

echo "spark cluster Docker build configuration is consistent"
