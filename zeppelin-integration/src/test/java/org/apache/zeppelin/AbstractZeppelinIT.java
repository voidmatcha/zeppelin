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

package org.apache.zeppelin;


import java.io.File;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.List;
import org.apache.commons.codec.binary.Base64;
import org.apache.commons.io.FileUtils;
import org.openqa.selenium.By;
import org.openqa.selenium.ElementClickInterceptedException;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.Keys;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.openqa.selenium.TimeoutException;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebDriverException;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

abstract public class AbstractZeppelinIT {

  protected WebDriverManager manager;

  private static final Logger LOGGER = LoggerFactory.getLogger(AbstractZeppelinIT.class);
  protected static final long MIN_IMPLICIT_WAIT = 5;
  protected static final long MAX_IMPLICIT_WAIT = 30;
  protected static final long MAX_BROWSER_TIMEOUT_SEC = 30;
  protected static final long MAX_PARAGRAPH_TIMEOUT_SEC = 120;

  protected void authenticationUser(String userName, String password) {
    // The AngularJS login modal binds its ng-model inputs a moment after they
    // render, so a single fill+submit can occasionally post credentials that
    // never reached the model and the login silently fails. The definitive
    // signal that login succeeded is the logged-in navbar user dropdown, so
    // submit the form and, if that dropdown does not appear, re-fill and
    // re-submit the still-open modal a few times before giving up.
    By userDropdown = By.xpath(
        "//div[contains(@class, 'navbar-collapse')]//li//button[contains(@class, 'nav-btn dropdown-toggle ng-scope')]");
    int maxAttempts = 3;
    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
      // A previous slow attempt may have logged in only after its wait elapsed;
      // if the logged-in dropdown is already showing, stop rather than re-opening
      // the modal (whose trigger is now gone and whose inputs would be mid-transition),
      // which is what turns a slow-but-successful login into a spurious failure.
      if (isElementDisplayed(userDropdown)) {
        break;
      }
      submitLoginForm(userName, password);
      try {
        // Wait the full browser timeout for the dropdown so a slow-but-successful
        // login is accepted rather than needlessly re-submitted.
        visibilityWait(userDropdown, MAX_BROWSER_TIMEOUT_SEC);
        break;
      } catch (TimeoutException e) {
        if (attempt == maxAttempts) {
          throw e;
        }
        // login did not complete (e.g. credentials never bound to ng-model);
        // the modal is still open, so loop to re-fill and re-submit it
      }
    }

    // dismiss any leftover modal overlay so it cannot intercept later clicks
    try {
      ((JavascriptExecutor) manager.getWebDriver()).executeScript(
          "$('.modal-backdrop').remove(); $('#loginModal').modal('hide');");
    } catch (Exception e) {
      // ignore if jQuery/Bootstrap not ready
    }
    ZeppelinITUtils.sleep(500, false);
  }

  private void submitLoginForm(String userName, String password) {
    // Open the login modal. A modal left over from a previous attempt (or still
    // fading in) can intercept this trigger click; if so the modal is already
    // open, so tolerate the interception and continue.
    try {
      clickableWait(
          By.xpath("//div[contains(@class, 'navbar-collapse')]//li//button[contains(.,'Login')]"),
          MAX_BROWSER_TIMEOUT_SEC).click();
    } catch (ElementClickInterceptedException e) {
      // login modal is already open/animating over the trigger; continue
    }

    // The login modal fades in, so its inputs and buttons are briefly present
    // but not yet interactable. Retry the actual interaction until it succeeds
    // rather than asserting interactability up front, which avoids
    // ElementNotInteractable/ElementClickIntercepted during the animation.
    sendKeysWhenInteractable(By.xpath("//*[@id='userName']"), userName);
    sendKeysWhenInteractable(By.xpath("//*[@id='password']"), password);
    clickWhenClickable(By.xpath("//*[@id='loginModalContent']//button[contains(.,'Login')]"));
  }

  protected void logoutUser(String userName) throws URISyntaxException {
    ZeppelinITUtils.sleep(500, false);
    clickableWait(
        By.xpath("//div[contains(@class, 'navbar-collapse')]//li[contains(.,'" + userName + "')]"),
        MAX_BROWSER_TIMEOUT_SEC).click();
    ZeppelinITUtils.sleep(500, false);
    clickableWait(
        By.xpath("//div[contains(@class, 'navbar-collapse')]//li[contains(.,'" + userName + "')]//a[@ng-click='navbar.logout()']"),
        MAX_BROWSER_TIMEOUT_SEC).click();
    ZeppelinITUtils.sleep(2000, false);
    try {
      WebElement closeButton = manager.getWebDriver().findElement(
          By.xpath("//*[@id='loginModal']//div[contains(@class, 'modal-header')]/button"));
      if (closeButton.isDisplayed()) {
        closeButton.click();
      }
    } catch (NoSuchElementException e) {
      // login modal close button not found, which is fine
    }
    manager.getWebDriver().get(new URI(manager.getWebDriver().getCurrentUrl()).resolve("/classic/#/").toString());
    ZeppelinITUtils.sleep(500, false);
  }
  
  protected void setTextOfParagraph(int paragraphNo, String text) {
    String paragraphXpath = getParagraphXPath(paragraphNo);

    try {
      manager.getWebDriver().manage().timeouts().implicitlyWait(Duration.ofMillis(100));
      // make sure ace code is visible, if not click on show editor icon to make it visible
      manager.getWebDriver()
        .findElement(By.xpath(paragraphXpath + "//span[@class='icon-size-fullscreen']")).click();
    } catch (NoSuchElementException e) {
      // ignore
    } finally {
      manager.getWebDriver().manage().timeouts()
        .implicitlyWait(Duration.ofSeconds(AbstractZeppelinIT.MAX_BROWSER_TIMEOUT_SEC));
    }
    String editorId = pollingWait(By.xpath(paragraphXpath + "//div[contains(@class, 'editor')]"),
        MIN_IMPLICIT_WAIT).getAttribute("id");
    if (manager.getWebDriver() instanceof JavascriptExecutor) {
      ((JavascriptExecutor) manager.getWebDriver())
        .executeScript("ace.edit('" + editorId + "'). setValue('" + text + "')");
    } else {
      throw new IllegalStateException("This driver does not support JavaScript!");
    }
  }

  protected void runParagraph(int paragraphNo) {
    By by = By.xpath(getParagraphXPath(paragraphNo) + "//span[@class='icon-control-play']");
    clickAndWait(by);
  }

  protected void cancelParagraph(int paragraphNo) {
    By by = By.xpath(getParagraphXPath(paragraphNo) + "//span[@class='icon-control-pause']");
    clickAndWait(by);
  }

  protected static String getParagraphXPath(int paragraphNo) {
    return "(//div[@ng-controller=\"ParagraphCtrl\"])[" + paragraphNo + "]";
  }

  protected static String getNoteFormsXPath() {
    return "(//div[@id='noteForms'])";
  }

  protected boolean waitForParagraph(final int paragraphNo, final String state) {
    By locator = By.xpath(getParagraphXPath(paragraphNo)
        + "//div[contains(@class, 'control')]//span[2][contains(.,'" + state + "')]");
    WebElement element = visibilityWait(locator, MAX_PARAGRAPH_TIMEOUT_SEC);
    return element.isDisplayed();
  }

  protected String getParagraphStatus(final int paragraphNo) {
    By locator = By.xpath(getParagraphXPath(paragraphNo)
        + "//div[contains(@class, 'control')]/span[2]");

    return manager.getWebDriver().findElement(locator).getText();
  }

  protected boolean waitForText(final String txt, final By locator) {
    try {
      WebElement element = visibilityWait(locator, MAX_BROWSER_TIMEOUT_SEC);
      return txt.equals(element.getText());
    } catch (TimeoutException e) {
      return false;
    }
  }

  protected WebElement pollingWait(final By locator, final long timeWait) {
    WebDriverWait wait = new WebDriverWait(manager.getWebDriver(),
        Duration.ofSeconds(timeWait));
    return wait.until(ExpectedConditions.presenceOfElementLocated(locator));
  }

  protected WebElement visibilityWait(final By locator, final long timeWait) {
    WebDriverWait wait = new WebDriverWait(manager.getWebDriver(),
        Duration.ofSeconds(timeWait));
    return wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
  }

  protected WebElement clickableWait(final By locator, final long timeWait) {
    WebDriverWait wait = new WebDriverWait(manager.getWebDriver(),
        Duration.ofSeconds(timeWait));
    return wait.until(ExpectedConditions.elementToBeClickable(locator));
  }

  /**
   * Type into an element as soon as it becomes interactable. The element may be
   * present but reject input while a modal or its animation is still settling,
   * so this retries the actual {@code sendKeys} (ignoring transient WebDriver
   * errors such as ElementNotInteractable/StaleElement) until it succeeds or the
   * timeout elapses.
   */
  protected void sendKeysWhenInteractable(final By locator, final CharSequence keys) {
    new WebDriverWait(manager.getWebDriver(), Duration.ofSeconds(MAX_BROWSER_TIMEOUT_SEC))
        .ignoring(WebDriverException.class)
        .until(driver -> {
          WebElement element = driver.findElement(locator);
          element.clear();
          element.sendKeys(keys);
          return true;
        });
  }

  /**
   * Click an element as soon as the click actually succeeds. A modal or its
   * fade animation can briefly intercept clicks, so this retries the real
   * {@code click()} (ignoring transient WebDriver errors such as
   * ElementClickIntercepted/StaleElement) until it lands or the timeout elapses.
   */
  protected void clickWhenClickable(final By locator) {
    new WebDriverWait(manager.getWebDriver(), Duration.ofSeconds(MAX_BROWSER_TIMEOUT_SEC))
        .ignoring(WebDriverException.class)
        .until(driver -> {
          driver.findElement(locator).click();
          return true;
        });
  }

  /**
   * Non-blocking check for whether an element is currently present and visible.
   * Unlike the {@code *Wait} helpers this never waits and never throws, so it can
   * be used to branch on transient UI state (for example, whether login already
   * completed) without failing the test when the element is absent.
   */
  protected boolean isElementDisplayed(final By locator) {
    try {
      List<WebElement> elements = manager.getWebDriver().findElements(locator);
      return !elements.isEmpty() && elements.get(0).isDisplayed();
    } catch (WebDriverException e) {
      return false;
    }
  }

  protected void createNewNote() {
    clickAndWait(By.xpath("//div[contains(@class, \"col-md-4\")]/div/h5/a[contains(.,'Create new" +
        " note')]"));

    WebDriverWait block =
      new WebDriverWait(manager.getWebDriver(), Duration.ofSeconds(MAX_BROWSER_TIMEOUT_SEC));
    block.until(ExpectedConditions.visibilityOfElementLocated(By.id("noteCreateModal")));
    clickAndWait(By.id("createNoteButton"));
    block.until(ExpectedConditions.invisibilityOfElementLocated(By.id("createNoteButton")));
  }

  protected void deleteTestNotebook(final WebDriver driver) {
    WebDriverWait block = new WebDriverWait(driver, Duration.ofSeconds(MAX_BROWSER_TIMEOUT_SEC));
    driver.findElement(By.xpath(".//*[@id='main']//button[@ng-click='moveNoteToTrash(note.id)']"))
        .sendKeys(Keys.ENTER);
    block.until(ExpectedConditions.visibilityOfElementLocated(By.xpath(".//*[@id='main']//button[@ng-click='moveNoteToTrash(note.id)']")));
    driver.findElement(By.xpath("//div[@class='modal-dialog'][contains(.,'This note will be moved to trash')]" +
        "//div[@class='modal-footer']//button[contains(.,'OK')]")).click();
    ZeppelinITUtils.sleep(100, false);
  }

  protected void deleteTrashNotebook(final WebDriver driver) {
    WebDriverWait block = new WebDriverWait(driver, Duration.ofSeconds(MAX_BROWSER_TIMEOUT_SEC));
    driver.findElement(By.xpath(".//*[@id='main']//button[@ng-click='removeNote(note.id)']"))
        .sendKeys(Keys.ENTER);
    block.until(ExpectedConditions.visibilityOfElementLocated(By.xpath(".//*[@id='main']//button[@ng-click='removeNote(note.id)']")));
    driver.findElement(By.xpath("//div[@class='modal-dialog'][contains(.,'This cannot be undone. Are you sure?')]" +
        "//div[@class='modal-footer']//button[contains(.,'OK')]")).click();
    ZeppelinITUtils.sleep(100, false);
  }

  protected void clickAndWait(final By locator) {
    WebElement element = clickableWait(locator, MAX_IMPLICIT_WAIT);
    try {
      element.click();
      ZeppelinITUtils.sleep(1000, false);
    } catch (ElementClickInterceptedException e) {
      // if the previous click did not happened mean the element is behind another clickable element
      Actions action = new Actions(manager.getWebDriver());
      action.moveToElement(element).click().build().perform();
      ZeppelinITUtils.sleep(1500, false);
    }
  }

  protected void handleException(String message, Exception e) throws Exception {
    LOGGER.error(message, e);
    File scrFile = ((TakesScreenshot) manager.getWebDriver()).getScreenshotAs(OutputType.FILE);
    LOGGER.error("ScreenShot::\ndata:image/png;base64," + new String(Base64.encodeBase64(FileUtils.readFileToByteArray(scrFile))));
    throw e;
  }

}
