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

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import prettier from 'prettier';

const input = new URL('../../zeppelin-server/target/assistant-contract/openapi.json', import.meta.url);
const output = new URL('../projects/zeppelin-sdk/src/interfaces/assistant-rest.generated.ts', import.meta.url);
const license = await readFile(new URL(import.meta.url), 'utf8');
const header = license.slice(0, license.indexOf('import '));
const schema = JSON.parse(await readFile(input, 'utf8'));
const generated = await prettier.format(
  header + '// Generated from the Java Assistant REST resources. Do not edit.\n' + astToString(await openapiTS(schema)),
  { ...(await prettier.resolveConfig(fileURLToPath(output))), parser: 'typescript' }
);
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== generated) {
    throw new Error('Assistant REST types are stale. Run npm run generate:assistant-rest-types and commit the result.');
  }
} else {
  await writeFile(output, generated);
}
console.log(
  `Assistant REST types ${process.argv.includes('--check') ? 'match' : 'generated'}: ${fileURLToPath(output)}`
);
