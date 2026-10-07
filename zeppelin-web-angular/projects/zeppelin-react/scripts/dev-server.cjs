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

const http = require('node:http');
const webpack = require('webpack');
const webpackDevMiddleware = require('webpack-dev-middleware');
const createWebpackConfig = require('../webpack.config');

const HOST = 'localhost';
const PORT = 3001;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization'
};

function createRequestHandler(middleware) {
  return (request, response) => {
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      response.setHeader(name, value);
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    middleware(request, response, () => {
      const acceptsHtml = (request.headers?.accept || '')
        .split(',')
        .some(value => value.trim().startsWith('text/html'));
      if (!['GET', 'HEAD'].includes(request.method) || !acceptsHtml) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }

      const originalUrl = request.url;
      request.url = '/index.html';
      middleware(request, response, () => {
        request.url = originalUrl;
        response.writeHead(404);
        response.end('Not Found');
      });
    });
  };
}

function createDevServer() {
  const config = createWebpackConfig(undefined, { mode: 'development' });
  const compiler = webpack(config);
  const middleware = webpackDevMiddleware(compiler, { publicPath: '/' });
  const server = http.createServer(createRequestHandler(middleware));

  return {
    listen(callback) {
      server.listen(PORT, HOST, callback);
    },
    close(callback) {
      server.close(() => middleware.close(callback));
    }
  };
}

if (require.main === module) {
  const devServer = createDevServer();
  devServer.listen(() => {
    console.log(`React development server listening on http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    devServer.close(error => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = { CORS_HEADERS, createDevServer, createRequestHandler };
