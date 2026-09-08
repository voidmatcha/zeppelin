#!/bin/bash
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

: "${HADOOP_HOME:=/usr/local/hadoop}"

. "$HADOOP_HOME/etc/hadoop/hadoop-env.sh"

rm -f /tmp/*.pid

# installing libraries if any - (resource urls added comma separated to the ACP system variable)
cd "$HADOOP_HOME/share/hadoop/common"
ACP_URLS="${ACP:-}"
for cp in ${ACP_URLS//,/ }; do
  echo "== $cp"
  curl -fLO -- "$cp"
done
cd - > /dev/null

# generate ssh keys at runtime so the image does not ship a shared private key.
# "ssh-keygen -A" only creates the host key types that are missing.
ssh-keygen -A
mkdir -p /root/.ssh
if [ ! -f /root/.ssh/id_rsa ]; then
  ssh-keygen -q -N "" -t rsa -f /root/.ssh/id_rsa
fi
# authorize the current key even when authorized_keys survived from an earlier run
touch /root/.ssh/authorized_keys
if ! grep -qxF "$(cat /root/.ssh/id_rsa.pub)" /root/.ssh/authorized_keys; then
  cat /root/.ssh/id_rsa.pub >> /root/.ssh/authorized_keys
fi
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys

# format on first start only. Doing this at build time put the metadata in the
# image, where a volume mounted on /data would shadow it. Both properties may
# name several comma separated directories, each optionally with a file: URI
# scheme, so walk them instead of treating the value as one path.
normalize_storage_dir() {
  local _dir="$1"
  # Trim separators' whitespace without changing spaces inside a directory name.
  _dir="${_dir#"${_dir%%[![:space:]]*}"}"
  _dir="${_dir%"${_dir##*[![:space:]]}"}"
  # Hadoop decodes URI escapes; shell file checks do not. Refuse these before
  # deciding whether metadata is absent rather than inspecting the wrong path.
  case "$_dir" in
    file:*%*)
      echo "Percent-encoded storage URIs are not supported: $_dir. Use an unescaped local absolute path instead." >&2
      return 1
      ;;
  esac
  case "$_dir" in
    file:///*) _dir="${_dir#file://}" ;;
    file://*) echo "Unsupported storage URI authority: $_dir" >&2; return 1 ;;
    file:/*) _dir="${_dir#file:}" ;;
  esac
  case "$_dir" in
    ""|/*) ;;
    *) echo "Storage directories must use local absolute paths: $_dir" >&2; return 1 ;;
  esac
  printf '%s' "$_dir"
}

first_dir_with_version() {
  local _candidate
  local -a _directories
  IFS=',' read -r -a _directories <<< "$1"
  for _candidate in "${_directories[@]}"; do
    _candidate="$(normalize_storage_dir "$_candidate")" || return
    [ -n "$_candidate" ] || continue
    if [ -f "$_candidate/current/VERSION" ]; then
      printf '%s' "$_candidate"
      return 0
    fi
  done
  return 0
}

first_dir_half_formatted() {
  local _candidate
  local -a _directories
  IFS=',' read -r -a _directories <<< "$1"
  for _candidate in "${_directories[@]}"; do
    _candidate="$(normalize_storage_dir "$_candidate")" || return
    [ -n "$_candidate" ] || continue
    if [ -d "$_candidate/current" ] && [ ! -f "$_candidate/current/VERSION" ]; then
      printf '%s' "$_candidate"
      return 0
    fi
  done
  return 0
}

first_dir_with_data() {
  local _candidate _contents
  local -a _directories
  IFS=',' read -r -a _directories <<< "$1"
  for _candidate in "${_directories[@]}"; do
    # Hadoop StorageLocation accepts a leading [TYPE], e.g. [DISK]/data/hdfs.
    # Inspect the backing path, not a literal directory containing that token.
    _candidate="${_candidate#"${_candidate%%[![:space:]]*}"}"
    case "$_candidate" in
      \[*\]*) _candidate="${_candidate#*]}" ;;
    esac
    _candidate="$(normalize_storage_dir "$_candidate")" || return
    [ -n "$_candidate" ] && [ -d "$_candidate" ] || continue
    # VERSION can be missing while the block pool still contains recoverable
    # data. Ignore only Hadoop's lock file, never the remaining storage files.
    _contents="$(find -H "$_candidate" -type f ! -name in_use.lock -print -quit)" || return
    if [ -n "$_contents" ]; then
      printf '%s' "$_candidate"
      return 0
    fi
  done
  return 0
}

NAME_DIRS="$("$HADOOP_HOME/bin/hdfs" getconf -confKey dfs.namenode.name.dir)"
DATA_DIRS="$("$HADOOP_HOME/bin/hdfs" getconf -confKey dfs.datanode.data.dir)"
NAME_DIR_WITH_VERSION="$(first_dir_with_version "$NAME_DIRS")"
if [ -z "$NAME_DIR_WITH_VERSION" ]; then
  # A "current" without VERSION is a half-written format. Hadoop refuses to
  # format over it in non-interactive mode, so say what to do rather than
  # letting the namenode fail with "NameNode is not formatted" on every boot.
  HALF_FORMATTED="$(first_dir_half_formatted "$NAME_DIRS")"
  if [ -n "$HALF_FORMATTED" ]; then
    echo "$HALF_FORMATTED/current exists but has no VERSION file, so an earlier format did not finish." >&2
    echo "Remove $HALF_FORMATTED to start over; anything already in HDFS is lost with it." >&2
    exit 1
  fi
  # Datanode blocks without namenode metadata cannot be turned back into files:
  # formatting mints a new namespace and block pool, so the old blocks would be
  # orphaned even though the datanode would happily register. Refuse instead of
  # silently starting an empty filesystem on top of somebody's data.
  DATA_DIR_WITH_DATA="$(first_dir_with_data "$DATA_DIRS")"
  if [ -n "$DATA_DIR_WITH_DATA" ]; then
    echo "$DATA_DIR_WITH_DATA holds datanode storage files but no namenode metadata was found." >&2
    echo "Formatting would create an empty filesystem and orphan those blocks." >&2
    echo "Remove the datanode directory to start fresh, or restore the namenode metadata." >&2
    exit 1
  fi
  "$HADOOP_HOME/bin/hdfs" namenode -format -nonInteractive
fi

# start hadoop
service ssh start
"$HADOOP_HOME/sbin/start-dfs.sh"
"$HADOOP_HOME/sbin/start-yarn.sh"

if ! jps | awk '$2 == "NameNode" { found = 1 } END { exit !found }'; then
  echo "The namenode did not start. Its log under $HADOOP_HOME/logs says why;" >&2
  echo "a volume holding a partially written namespace is the usual cause." >&2
  exit 1
fi

"$HADOOP_HOME/bin/hdfs" dfsadmin -safemode leave
"$HADOOP_HOME/bin/hdfs" dfs -mkdir -p /spark
# spark.yarn.jars points at /spark/jars, so the upload has to be repeated when
# the jars are gone or when a persistent volume still holds another release:
# the marker records which release is up there, and fsck catches blocks that
# went away with a datanode directory. Checking only the marker would leave
# submits failing with a missing ExecutorLauncher.
if ! SPARK_RELEASE="$(head -1 "$SPARK_HOME/RELEASE" 2>/dev/null)" || [ -z "$SPARK_RELEASE" ]; then
  echo "Cannot determine the Spark release from $SPARK_HOME/RELEASE; leaving uploaded jars untouched." >&2
  exit 1
fi
# A datanode that refused to register leaves the namespace readable but every
# block unreadable. Deleting and re-uploading in that state destroys the cache
# and then fails anyway, so stop while the jars are still listed.
LIVE_DATANODES=""
for _attempt in $(seq 1 30); do
  LIVE_DATANODES="$("$HADOOP_HOME/bin/hdfs" dfsadmin -report 2>/dev/null | grep -m1 "Live datanodes" || true)"
  case "$LIVE_DATANODES" in
    ""|*"(0)"*) sleep 2 ;;
    *) break ;;
  esac
done
case "$LIVE_DATANODES" in
  ""|*"(0)"*)
    echo "No live datanode registered, so the HDFS copy of the Spark jars cannot be verified." >&2
    echo "Check the datanode log for \"Incompatible clusterIDs\"; the volume may mix two clusters." >&2
    exit 1
    ;;
esac
UPLOADED=""
if "$HADOOP_HOME/bin/hdfs" dfs -test -d /spark/jars; then
  # separate "cannot check" from "checked and broken": only the latter is a
  # reason to throw the cache away
  # fsck exits non-zero when it finds corruption, so the status line is what
  # separates "checked and broken" from "could not check at all".
  FSCK_OUTPUT="$("$HADOOP_HOME/bin/hdfs" fsck /spark/jars 2>&1 || true)"
  FSCK_STATUS="$(printf '%s\n' "$FSCK_OUTPUT" | sed -n 's/^Status: //p')"
  if [ "$FSCK_STATUS" != HEALTHY ] && [ "$FSCK_STATUS" != CORRUPT ]; then
    echo "fsck did not report a status for /spark/jars, leaving it untouched." >&2
    printf '%s\n' "$FSCK_OUTPUT" >&2
    exit 1
  fi
  if [ "$FSCK_STATUS" = HEALTHY ]; then
    # A successful parent listing distinguishes a missing marker from an RPC
    # failure. A failed read of an existing marker must not discard the cache.
    if ! SPARK_PATHS="$("$HADOOP_HOME/bin/hdfs" dfs -ls -C /spark)"; then
      echo "Cannot list the Spark upload marker; leaving uploaded jars untouched." >&2
      exit 1
    fi
    if printf '%s\n' "$SPARK_PATHS" | grep -xF '/spark/.jars-upload-complete' > /dev/null; then
      if ! UPLOADED="$("$HADOOP_HOME/bin/hdfs" dfs -cat /spark/.jars-upload-complete)"; then
        echo "Cannot read the Spark upload marker; leaving uploaded jars untouched." >&2
        exit 1
      fi
    fi
  fi
fi
if [ "$UPLOADED" = "$SPARK_RELEASE" ]; then
  # fsck validates existing blocks, not whether somebody deleted a jar.
  LOCAL_JARS="$(find "$SPARK_HOME/jars" -maxdepth 1 -type f -print | sed 's#.*/##' | LC_ALL=C sort)"
  HDFS_JARS="$("$HADOOP_HOME/bin/hdfs" dfs -ls -C /spark/jars | sed 's#.*/##' | LC_ALL=C sort)"
  if [ "$LOCAL_JARS" != "$HDFS_JARS" ]; then
    UPLOADED=""
  fi
fi
if [ "$UPLOADED" != "$SPARK_RELEASE" ]; then
  "$HADOOP_HOME/bin/hdfs" dfs -rm -r -f /spark/jars /spark/.jars-upload-complete
  "$HADOOP_HOME/bin/hdfs" dfs -put "$SPARK_HOME/jars" /spark
  echo "$SPARK_RELEASE" | "$HADOOP_HOME/bin/hdfs" dfs -put -f - /spark/.jars-upload-complete
fi

# Re-uploading the jars says nothing about the rest of the namespace: a datanode
# directory that went missing takes every other file with it.
FSCK_OUTPUT="$("$HADOOP_HOME/bin/hdfs" fsck / 2>&1 || true)"
case "$(printf '%s\n' "$FSCK_OUTPUT" | sed -n 's/^Status: //p')" in
  HEALTHY) ;;
  CORRUPT)
    echo "Warning: HDFS reports missing or corrupt blocks. Affected files may be unreadable." >&2
    echo "Run hdfs fsck / to identify the affected paths." >&2
    ;;
  *)
    echo "Warning: HDFS health could not be checked; data loss has not been established." >&2
    printf '%s\n' "$FSCK_OUTPUT" >&2
    ;;
esac

# start spark
export SPARK_MASTER_PORT=7077

cd "$SPARK_HOME/sbin"
./start-master.sh
./start-worker.sh "spark://$(hostname):$SPARK_MASTER_PORT"

if [ "${1:-}" = "-d" ]; then
  # sshd is already listening from the start above; just keep the container in
  # the foreground. Rebinding port 22 here raced with the running daemon, and
  # "sshd -d" exits after serving a single connection.
  # Stay in bash rather than exec'ing: as pid 1 it still runs the trap on
  # "docker stop", and it reaps the daemons started above.
  trap 'exit 0' TERM INT
  tail -f /dev/null &
  wait $!
elif [ "$#" -eq 0 ]; then
  exit 0
else
  exec "$@"
fi
