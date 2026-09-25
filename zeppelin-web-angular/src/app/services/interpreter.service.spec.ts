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

import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BaseUrlService } from './base-url.service';
import { InterpreterService } from './interpreter.service';

describe('InterpreterService installation', () => {
  it('sends the interpreter name and Maven artifact to the install endpoint', () => {
    const post = vi.fn().mockReturnValue(of({}));
    const http = { post } as unknown as HttpClient;
    const baseUrl = { getRestApiBase: () => '/api' } as BaseUrlService;
    const service = new InterpreterService(http, baseUrl);

    service.installInterpreter('spark', 'org.apache.zeppelin:zeppelin-spark:0.12.0').subscribe();

    expect(post).toHaveBeenCalledWith('/api/interpreter/install', {
      name: 'spark',
      artifact: 'org.apache.zeppelin:zeppelin-spark:0.12.0'
    });
  });
});
