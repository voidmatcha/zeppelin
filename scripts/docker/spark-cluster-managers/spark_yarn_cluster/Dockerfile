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
ARG SPARK_VERSION=3.5.8
ARG SCALA_VERSION=2.12
ARG JAVA_VERSION=11
FROM apache/spark:${SPARK_VERSION}-scala${SCALA_VERSION}-java${JAVA_VERSION}-python3-ubuntu

USER root

ARG HADOOP_VERSION=3.3.6
ARG TARGETARCH
ENV HADOOP_VERSION=${HADOOP_VERSION} \
    HADOOP_HOME=/usr/local/hadoop \
    HADOOP_COMMON_HOME=/usr/local/hadoop \
    HADOOP_HDFS_HOME=/usr/local/hadoop \
    HADOOP_MAPRED_HOME=/usr/local/hadoop \
    HADOOP_YARN_HOME=/usr/local/hadoop \
    HADOOP_CONF_DIR=/usr/local/hadoop/etc/hadoop \
    PATH=${PATH}:${SPARK_HOME}/bin:/usr/local/hadoop/bin

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      openssh-server \
      procps \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/ssh/ssh_host_* \
    && mkdir -p /run/sshd /root/.ssh

# hadoop
RUN BUILD_ARCH="$TARGETARCH" \
    && if [ -z "$BUILD_ARCH" ]; then \
         case "$(uname -m)" in \
           x86_64) BUILD_ARCH=amd64 ;; \
           aarch64|arm64) BUILD_ARCH=arm64 ;; \
         esac; \
       fi \
    && case "$BUILD_ARCH" in \
      amd64) HADOOP_ARCHIVE="hadoop-$HADOOP_VERSION.tar.gz" ;; \
      arm64) HADOOP_ARCHIVE="hadoop-$HADOOP_VERSION-aarch64.tar.gz" ;; \
      *) echo "Unsupported architecture: ${BUILD_ARCH:-$(uname -m)}" >&2; exit 1 ;; \
    esac \
    && HADOOP_PATH="hadoop/common/hadoop-$HADOOP_VERSION/$HADOOP_ARCHIVE" \
    && HADOOP_URL="https://downloads.apache.org/$HADOOP_PATH" \
    && HADOOP_ARCHIVE_URL="https://archive.apache.org/dist/$HADOOP_PATH" \
    && CURL_OPTS="-fL --retry 3 --retry-delay 5 --connect-timeout 30 --speed-limit 1024 --speed-time 60" \
    && { curl $CURL_OPTS "$HADOOP_URL" -o "/tmp/$HADOOP_ARCHIVE" \
         || curl $CURL_OPTS "$HADOOP_ARCHIVE_URL" -o "/tmp/$HADOOP_ARCHIVE"; } \
    && { curl $CURL_OPTS "$HADOOP_ARCHIVE_URL.sha512" -o "/tmp/$HADOOP_ARCHIVE.sha512" \
         || curl $CURL_OPTS "$HADOOP_URL.sha512" -o "/tmp/$HADOOP_ARCHIVE.sha512"; } \
    && HADOOP_SHA512="$(sed -n 's/^SHA512 ([^)]*) = \([[:xdigit:]]\{128\}\)$/\1/p' "/tmp/$HADOOP_ARCHIVE.sha512")" \
    && test -n "$HADOOP_SHA512" \
    && echo "$HADOOP_SHA512  /tmp/$HADOOP_ARCHIVE" | sha512sum -c - \
    && tar -xzf "/tmp/$HADOOP_ARCHIVE" -C /usr/local/ \
    && rm "/tmp/$HADOOP_ARCHIVE" "/tmp/$HADOOP_ARCHIVE.sha512" \
    && ln -s /usr/local/hadoop-$HADOOP_VERSION $HADOOP_HOME

RUN printf '\nexport JAVA_HOME=%s\nexport HADOOP_HOME=/usr/local/hadoop\nexport HADOOP_CONF_DIR=/usr/local/hadoop/etc/hadoop\nexport HDFS_NAMENODE_USER=root\nexport HDFS_DATANODE_USER=root\nexport HDFS_SECONDARYNAMENODE_USER=root\nexport YARN_RESOURCEMANAGER_USER=root\nexport YARN_NODEMANAGER_USER=root\n' "$JAVA_HOME" \
    >> $HADOOP_HOME/etc/hadoop/hadoop-env.sh

# hadoop configurations
COPY hdfs_conf/core-site.xml $HADOOP_HOME/etc/hadoop/core-site.xml
COPY hdfs_conf/hdfs-site.xml $HADOOP_HOME/etc/hadoop/hdfs-site.xml
COPY hdfs_conf/mapred-site.xml $HADOOP_HOME/etc/hadoop/mapred-site.xml
COPY hdfs_conf/yarn-site.xml $HADOOP_HOME/etc/hadoop/yarn-site.xml

RUN mkdir /data/
RUN chmod 777 /data/
RUN $HADOOP_HOME/bin/hdfs namenode -format

# passwordless ssh (keys are generated at runtime by entrypoint.sh)
COPY ssh_config /root/.ssh/config
RUN chmod 600 /root/.ssh/config
RUN chown root:root /root/.ssh/config
RUN chmod +x /usr/local/hadoop/etc/hadoop/*-env.sh

# point spark-submit at the jars the entrypoint uploads to HDFS, so YARN
# applications do not re-upload $SPARK_HOME/jars on every submit
RUN mkdir -p "$SPARK_HOME/conf" \
    && echo "spark.yarn.jars hdfs:///spark/jars/*" \
       >> "$SPARK_HOME/conf/spark-defaults.conf"

# update boot script
COPY entrypoint.sh /etc/entrypoint.sh
RUN chown root:root /etc/entrypoint.sh
RUN chmod 700 /etc/entrypoint.sh

# Hdfs ports
EXPOSE 50010 50020 50075 9868 9870
# HDFS namenode rpc
EXPOSE 9000
#Yarn ports
EXPOSE 8030 8031 8032 8033 8040 8042 8088
#spark
EXPOSE 8080 7077 8081

ENTRYPOINT ["/etc/entrypoint.sh"]
