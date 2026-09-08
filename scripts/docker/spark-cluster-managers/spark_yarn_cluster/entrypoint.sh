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
# name several comma separated directories, each optionally with a file://
# scheme, so walk them instead of treating the value as one path.
# A "while read" behind a pipe runs in a subshell, so split on IFS instead and
# keep the result in this shell.
first_dir_with_version() {
  local _saved_ifs _candidate
  _saved_ifs="$IFS"
  IFS=','
  for _candidate in $1; do
    IFS="$_saved_ifs"
    _candidate="$(printf '%s' "$_candidate" | tr -d '[:space:]')"
    _candidate="${_candidate#file://}"
    if [ -f "$_candidate/current/VERSION" ]; then
      printf '%s' "$_candidate"
      return 0
    fi
    IFS=','
  done
  IFS="$_saved_ifs"
  return 0
}

first_dir_half_formatted() {
  local _saved_ifs _candidate
  _saved_ifs="$IFS"
  IFS=','
  for _candidate in $1; do
    IFS="$_saved_ifs"
    _candidate="$(printf '%s' "$_candidate" | tr -d '[:space:]')"
    _candidate="${_candidate#file://}"
    if [ -d "$_candidate/current" ] && [ ! -f "$_candidate/current/VERSION" ]; then
      printf '%s' "$_candidate"
      return 0
    fi
    IFS=','
  done
  IFS="$_saved_ifs"
  return 0
}

NAME_DIRS="$("$HADOOP_HOME/bin/hdfs" getconf -confKey dfs.namenode.name.dir)"
DATA_DIRS="$("$HADOOP_HOME/bin/hdfs" getconf -confKey dfs.datanode.data.dir)"
if [ -z "$(first_dir_with_version "$NAME_DIRS")" ]; then
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
  DATA_DIR_WITH_VERSION="$(first_dir_with_version "$DATA_DIRS")"
  if [ -n "$DATA_DIR_WITH_VERSION" ]; then
    echo "$DATA_DIR_WITH_VERSION holds datanode blocks but no namenode metadata was found." >&2
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

if ! jps | grep -q NameNode; then
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
SPARK_RELEASE="$(head -1 "$SPARK_HOME/RELEASE" 2>/dev/null || echo unknown)"
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
  FSCK_OUTPUT="$("$HADOOP_HOME/bin/hdfs" fsck /spark/jars 2>/dev/null || true)"
  if ! printf '%s' "$FSCK_OUTPUT" | grep -q "^Status:"; then
    echo "fsck did not report a status for /spark/jars, leaving it untouched." >&2
    exit 1
  fi
  if printf '%s' "$FSCK_OUTPUT" | grep -q "Status: HEALTHY"; then
    UPLOADED="$("$HADOOP_HOME/bin/hdfs" dfs -cat /spark/.jars-upload-complete 2>/dev/null || true)"
  fi
fi
if [ "$UPLOADED" != "$SPARK_RELEASE" ]; then
  "$HADOOP_HOME/bin/hdfs" dfs -rm -r -f /spark/jars /spark/.jars-upload-complete
  "$HADOOP_HOME/bin/hdfs" dfs -put "$SPARK_HOME/jars" /spark
  echo "$SPARK_RELEASE" | "$HADOOP_HOME/bin/hdfs" dfs -put -f - /spark/.jars-upload-complete
fi

# Re-uploading the jars says nothing about the rest of the namespace: a datanode
# directory that went missing takes every other file with it.
if ! "$HADOOP_HOME/bin/hdfs" fsck / 2>/dev/null | grep -q "Status: HEALTHY"; then
  echo "Warning: HDFS reports missing blocks outside the Spark jars." >&2
  echo "Files written before the datanode directory was lost cannot be read." >&2
fi

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
