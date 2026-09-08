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

import java.io.File;
import java.io.IOException;
import java.util.HashMap;

import org.apache.thrift.TException;
import org.apache.zeppelin.helium.DevInterpreter.InterpreterEvent;
import org.apache.zeppelin.interpreter.*;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterEventClient;
import org.apache.zeppelin.interpreter.remote.RemoteInterpreterServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Interpreter development server
 */
public class ZeppelinDevServer extends
    RemoteInterpreterServer implements InterpreterEvent, InterpreterOutputChangeListener {
  private static final Logger LOGGER = LoggerFactory.getLogger(ZeppelinDevServer.class);

  private DevInterpreter interpreter = null;
  public ZeppelinDevServer(int port) throws Exception {
    super(null, port, null, ":");
  }

  @Override
  protected Interpreter getInterpreter(String sessionId, String className) throws TException {
    synchronized (this) {
      InterpreterGroup interpreterGroup = getInterpreterGroup();
      if (interpreterGroup == null || interpreterGroup.isEmpty()) {
        createInterpreter(
            "dev",
            sessionId,
            DevInterpreter.class.getName(),
            new HashMap<String, String>(),
            "anonymous");
        notify();
      }
    }

    Interpreter intp = super.getInterpreter(sessionId, className);
    interpreter = (DevInterpreter) (
        ((LazyOpenInterpreter) intp).getInnerInterpreter());
    interpreter.setInterpreterEvent(this);
    return super.getInterpreter(sessionId, className);
  }

  @Override
  protected InterpreterOutput createInterpreterOutput(
      final String noteId, final String paragraphId, final String user) {
    return createInterpreterOutput(noteId, paragraphId, user, null);
  }

  @Override
  protected InterpreterOutput createInterpreterOutput(final String noteId, final String paragraphId,
      final String user, final Boolean personalized) {
    final RemoteInterpreterEventClient eventClient = getIntpEventClient();
    try {
      return new InterpreterOutput(new InterpreterOutputListener() {
        @Override
        public void onUpdateAll(InterpreterOutput out) {
          try {
            if (personalized == null) {
              eventClient.onInterpreterOutputUpdateAll(
                  noteId, paragraphId, out.toInterpreterResultMessage(), user);
            } else {
              eventClient.onInterpreterOutputUpdateAll(
                  noteId, paragraphId, out.toInterpreterResultMessage(), user, personalized);
            }
          } catch (IOException e) {
            LOGGER.error(e.getMessage(), e);
          }
        }

        @Override
        public void onAppend(int index, InterpreterResultMessageOutput out, byte[] line) {
          if (personalized == null) {
            eventClient.onInterpreterOutputAppend(noteId, paragraphId, index, new String(line), user);
          } else {
            eventClient.onInterpreterOutputAppend(
                noteId, paragraphId, index, new String(line), user, personalized);
          }
        }

        @Override
        public void onUpdate(int index, InterpreterResultMessageOutput out) {
          try {
            if (personalized == null) {
              eventClient.onInterpreterOutputUpdate(noteId, paragraphId,
                  index, out.getType(), new String(out.toByteArray()), user);
            } else {
              eventClient.onInterpreterOutputUpdate(noteId, paragraphId,
                  index, out.getType(), new String(out.toByteArray()), user, personalized);
            }
          } catch (IOException e) {
            LOGGER.error(e.getMessage(), e);
          }
        }
      }, this);
    } catch (IOException e) {
      LOGGER.error("Unable to create development output", e);
      return null;
    }
  }

  @Override
  public void fileChanged(File file) {
    refresh();
  }

  @Override
  public InterpreterResult interpret(String st, InterpreterContext context) {
    waitForConnected();
    return new InterpreterResult(InterpreterResult.Code.SUCCESS, "");
  }

  public void refresh() {
    interpreter.rerun();
  }

  /**
   * Wait until %dev paragraph is executed and connected to this process
   */
  public void waitForConnected() {
    synchronized (this) {
      while (!isConnected()) {
        try {
          this.wait(10 * 1000);
        } catch (InterruptedException e) {
          e.printStackTrace();
        }
      }
    }
  }

  public boolean isConnected() {
    return !(interpreter == null || interpreter.getLastInterpretContext() == null);
  }
}
