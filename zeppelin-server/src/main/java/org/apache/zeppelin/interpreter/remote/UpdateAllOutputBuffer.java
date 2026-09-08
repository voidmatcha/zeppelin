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

package org.apache.zeppelin.interpreter.remote;

import java.util.List;
import org.apache.zeppelin.interpreter.InterpreterResultMessage;

/**
 * Keeps a paragraph clear and all replacement results together in the output queue.
 */
class UpdateAllOutputBuffer extends AppendOutputBuffer {

  private final List<InterpreterResultMessage> messages;

  UpdateAllOutputBuffer(String noteId, String paragraphId,
                        List<InterpreterResultMessage> messages) {
    this(noteId, paragraphId, messages, null);
  }

  UpdateAllOutputBuffer(String noteId, String paragraphId,
                        List<InterpreterResultMessage> messages, String user) {
    this(noteId, paragraphId, messages, user, null);
  }

  UpdateAllOutputBuffer(String noteId, String paragraphId,
                        List<InterpreterResultMessage> messages, String user,
                        Boolean personalized) {
    super(noteId, paragraphId, 0, "", user, personalized);
    this.messages = List.copyOf(messages);
  }

  List<InterpreterResultMessage> getMessages() {
    return messages;
  }
}
