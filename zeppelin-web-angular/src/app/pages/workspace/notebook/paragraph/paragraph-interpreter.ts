/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { InterpreterBindingItem } from '@zeppelin/sdk';

// Mirrors ParagraphTextParser.REPL_PATTERN on the server: `%spark.pyspark`, which may be followed
// by `(local properties)` or by the script. The whitespace is spelled out, since the server's `\s`
// is ASCII only and the one of JavaScript is not.
const REPL_PATTERN = /^[ \t\n\v\f\r]*%([a-zA-Z0-9_-]+(?:\.\w+)*)/;

// Every interpreter group accepts it, though the server does not list it among its interpreters.
const CONF_INTERPRETER = 'conf';

/** The `%name` a paragraph starts with, e.g. `spark.pyspark`, or undefined when it has no directive. */
export const findReplName = (text: string | undefined): string | undefined => REPL_PATTERN.exec(text ?? '')?.[1];

/**
 * Finds the interpreter setting a paragraph runs on, by the rules the server applies when it runs
 * the paragraph (InterpreterFactory#getInterpreter): `%group.name` names both parts, a lone `%name`
 * is first read as an interpreter of the note's default setting and then as a setting, and a
 * paragraph without a directive runs on the default setting, which is the first bound one.
 */
export const findParagraphInterpreter = (
  text: string | undefined,
  bindings: InterpreterBindingItem[]
): InterpreterBindingItem | undefined => {
  const defaultSetting = bindings.find(item => item.selected);
  const replName = findReplName(text);
  if (!replName) {
    return defaultSetting;
  }

  const hasInterpreter = (setting: InterpreterBindingItem | undefined, name: string) =>
    !!setting && (name === CONF_INTERPRETER || setting.interpreters.some(interpreter => interpreter.name === name));
  const findSetting = (name: string) => bindings.find(item => item.name === name);

  const names = replName.split('.');
  if (names.length === 2) {
    const setting = findSetting(names[0]);
    return hasInterpreter(setting, names[1]) ? setting : undefined;
  }
  if (names.length === 1) {
    return hasInterpreter(defaultSetting, names[0]) ? defaultSetting : findSetting(names[0]);
  }
  return undefined;
};
