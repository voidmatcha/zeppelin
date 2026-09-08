#!/bin/bash
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements. See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

export SPARK_MASTER_PORT=7077

# run spark
cd "$SPARK_HOME/sbin"
./start-master.sh
./start-worker.sh "spark://$(hostname):$SPARK_MASTER_PORT"

if [ "${1:-}" = "-d" ]; then
  # keep the container in the foreground. An sshd nobody could log into used to
  # serve this purpose. Stay in bash so the trap still runs on "docker stop".
  trap 'exit 0' TERM INT
  tail -f /dev/null &
  wait $!
elif [ "$#" -eq 0 ]; then
  exit 0
else
  exec "$@"
fi
