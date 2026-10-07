/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CORS_HEADERS, createRequestHandler } = require('./dev-server.cjs');

function createResponse() {
  const headers = {};
  return {
    body: '',
    ended: false,
    headers,
    statusCode: undefined,
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body = '') {
      this.body = body;
      this.ended = true;
    }
  };
}

test('answers preflight requests without invoking webpack', () => {
  let invoked = false;
  const handler = createRequestHandler(() => {
    invoked = true;
  });
  const response = createResponse();

  handler({ headers: {}, method: 'OPTIONS', url: '/remoteEntry.js' }, response);

  assert.equal(invoked, false);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(response.headers, CORS_HEADERS);
});

test('serves an asset through webpack middleware with CORS headers', () => {
  const handler = createRequestHandler((_request, response) => {
    response.writeHead(200);
    response.end('asset');
  });
  const response = createResponse();

  handler({ headers: { accept: '*/*' }, method: 'GET', url: '/remoteEntry.js' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'asset');
  assert.deepEqual(response.headers, CORS_HEADERS);
});

test('falls back to the generated index for an unmatched path', () => {
  const urls = [];
  const handler = createRequestHandler((request, response, next) => {
    urls.push(request.url);
    if (request.url === '/index.html') {
      response.writeHead(200);
      response.end('index');
      return;
    }
    next();
  });
  const response = createResponse();

  handler({ headers: { accept: 'text/html,application/xhtml+xml' }, method: 'GET', url: '/nested/route' }, response);

  assert.deepEqual(urls, ['/nested/route', '/index.html']);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'index');
});

test('returns 404 when neither the asset nor index exists', () => {
  const request = { headers: { accept: '*/*' }, method: 'GET', url: '/missing.js' };
  const handler = createRequestHandler((_request, _response, next) => next());
  const response = createResponse();

  handler(request, response);

  assert.equal(request.url, '/missing.js');
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, 'Not Found');
});
