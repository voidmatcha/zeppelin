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

package org.apache.zeppelin.integration;

import java.io.IOException;
import java.time.Duration;
import org.apache.zeppelin.AbstractZeppelinIT;
import org.apache.zeppelin.MiniZeppelinServer;
import org.apache.zeppelin.WebDriverManager;
import org.apache.zeppelin.test.DownloadUtils;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AngularDisplayIT extends AbstractZeppelinIT {
  private static MiniZeppelinServer zepServer;

  @BeforeAll
  static void init() throws Exception {
    String sparkHome = DownloadUtils.downloadSpark();
    zepServer = new MiniZeppelinServer(AngularDisplayIT.class.getSimpleName());
    zepServer.addInterpreter("spark");
    zepServer.addInterpreter("angular");
    zepServer.copyLogProperties();
    zepServer.copyBinDir();
    zepServer.start(true, AngularDisplayIT.class.getSimpleName());
    TestHelper.configureSparkInterpreter(zepServer, sparkHome);
  }

  @BeforeEach
  void startUp() throws IOException {
    manager = new WebDriverManager(zepServer.getZeppelinConfiguration().getServerPort());
    createNewNote();
    waitForParagraph(1, "READY");
  }

  @AfterEach
  void closeBrowser() throws IOException {
    if (manager != null) {
      manager.close();
    }
  }

  @AfterAll
  static void tearDown() throws Exception {
    zepServer.destroy();
  }

  @Test
  void testAngularModelPrimitiveCompatibility() {
    setTextOfParagraph(1, String.join("\\n",
        "import org.apache.zeppelin.display.angular.{notebookscope => n, paragraphscope => p}",
        "val compatCount = n.AngularModel(\"compatCount\", 1)",
        "val compatEnabled = n.AngularModel(\"compatEnabled\", true)",
        "val localCount = p.AngularModel(\"localCount\", 1)",
        "localCount.value(2)",
        "assert(localCount.remove() == 2)",
        "val localEnabled = p.AngularModel(\"localEnabled\", true)",
        "localEnabled.value(false)",
        "assert(localEnabled.remove() == false)"));
    runCompatibilityParagraph(1);

    setTextOfParagraph(2, "%angular <div id=\"compat-value\">"
        + "{{compatCount}}|{{compatEnabled}}</div>"
        + "<button id=\"compat-update\" ng-click=\"compatCount = compatCount + 1; "
        + "compatEnabled = !compatEnabled\">Update binding</button>");
    runCompatibilityParagraph(2);
    WebDriverWait wait = new WebDriverWait(manager.getWebDriver(),
        Duration.ofSeconds(MAX_BROWSER_TIMEOUT_SEC));
    wait.until(ExpectedConditions.textToBe(By.id("compat-value"), "1|true"));

    new Actions(manager.getWebDriver())
        .moveToElement(manager.getWebDriver().findElement(By.id("compat-update"))).perform();
    clickableWait(By.id("compat-update"), MAX_BROWSER_TIMEOUT_SEC).click();
    wait.until(ExpectedConditions.textToBe(By.id("compat-value"), "2|false"));

    setTextOfParagraph(3, String.join("\\n",
        "assert(compatCount() == 2)",
        "assert(compatEnabled() == false)",
        "compatCount.value(3)",
        "compatEnabled.value(true)",
        "println(\"primitive binding round trip passed\")"));
    runCompatibilityParagraph(3);
    wait.until(ExpectedConditions.textToBe(By.id("compat-value"), "3|true"));

    setTextOfParagraph(4, String.join("\\n",
        "assert(compatCount.remove() == 3)",
        "assert(compatEnabled.remove() == true)",
        "assert(compatCount() == None)",
        "assert(compatEnabled() == None)"));
    runCompatibilityParagraph(4);
  }

  private void runCompatibilityParagraph(int paragraphNo) {
    runParagraph(paragraphNo);
    String status = new WebDriverWait(manager.getWebDriver(),
        Duration.ofSeconds(MAX_PARAGRAPH_TIMEOUT_SEC)).until(driver -> {
          String current = getParagraphStatus(paragraphNo);
          return "FINISHED".equals(current) || "ERROR".equals(current) ? current : null;
        });
    assertEquals("FINISHED", status, "Paragraph " + paragraphNo + ": "
        + manager.getWebDriver().findElement(By.xpath(getParagraphXPath(paragraphNo))).getText());
  }

}
