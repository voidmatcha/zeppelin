/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.apache.zeppelin.helium;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import org.apache.zeppelin.conf.ZeppelinConfiguration;
import org.apache.zeppelin.conf.ZeppelinConfiguration.ConfVars;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class HeliumBundleFactoryPathTest {
  @TempDir
  File temporaryHome;

  @Test
  void resolveFrameworkModulesFromUiIndependentSource() throws IOException {
    ZeppelinConfiguration zConf = ZeppelinConfiguration.load();
    zConf.setProperty(ConfVars.ZEPPELIN_HOME.getVarName(), temporaryHome.getAbsolutePath());

    for (String moduleName : new String[] {
        "zeppelin-tabledata", "zeppelin-vis", "zeppelin-spell"}) {
      File module = new File(temporaryHome, "zeppelin-helium/" + moduleName);
      assertTrue(module.mkdirs());
      assertEquals(module.getCanonicalFile(),
          HeliumBundleFactory.resolveFrameworkModulePath(zConf, moduleName).getCanonicalFile());
    }
  }

  @Test
  void resolveFrameworkModulesFromDistributionWhenSourceIsAbsent() throws IOException {
    ZeppelinConfiguration zConf = ZeppelinConfiguration.load();
    zConf.setProperty(ConfVars.ZEPPELIN_HOME.getVarName(), temporaryHome.getAbsolutePath());

    for (String moduleName : new String[] {
        "zeppelin-tabledata", "zeppelin-vis", "zeppelin-spell"}) {
      File expected = new File(temporaryHome, "lib/node_modules/" + moduleName);
      assertEquals(expected.getCanonicalFile(),
          HeliumBundleFactory.resolveFrameworkModulePath(zConf, moduleName).getCanonicalFile());
    }
  }
}
