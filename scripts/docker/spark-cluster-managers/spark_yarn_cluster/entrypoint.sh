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

# start hadoop
service ssh start
"$HADOOP_HOME/sbin/start-dfs.sh"
"$HADOOP_HOME/sbin/start-yarn.sh"

"$HADOOP_HOME/bin/hdfs" dfsadmin -safemode leave
"$HADOOP_HOME/bin/hdfs" dfs -mkdir -p /spark
if ! "$HADOOP_HOME/bin/hdfs" dfs -test -e /spark/.jars-upload-complete; then
  "$HADOOP_HOME/bin/hdfs" dfs -rm -r -f /spark/jars
  "$HADOOP_HOME/bin/hdfs" dfs -put "$SPARK_HOME/jars" /spark
  "$HADOOP_HOME/bin/hdfs" dfs -touchz /spark/.jars-upload-complete
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
