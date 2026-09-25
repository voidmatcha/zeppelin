<!--
Licensed to the Apache Software Foundation (ASF) under one or more
contributor license agreements. See the NOTICE file distributed with
this work for additional information regarding copyright ownership.
The ASF licenses this file to You under the Apache License, Version 2.0
(the "License"); you may not use this file except in compliance with
the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Zeppelin Helium JavaScript APIs

This directory is the canonical source for the JavaScript packages that
`HeliumBundleFactory` exposes to Helium packages:

- `zeppelin-tabledata`
- `zeppelin-vis`
- `zeppelin-spell`

They live outside both web UIs so the server can build Helium bundles without
the Classic UI source tree or the `web-classic` Maven profile. The distribution
assembly copies these directories to `lib/node_modules`.

The copies under `zeppelin-web/src/app/{tabledata,visualization,spell}` are
temporarily retained while the Classic UI still exists. Classic webpack resolves
the package names to this directory, so executable code has a single canonical
source. The remaining duplicate Classic templates can be removed together with
the Classic UI.
