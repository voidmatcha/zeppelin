<!--
  ~ Licensed under the Apache License, Version 2.0 (the "License");
  ~ you may not use this file except in compliance with the License.
  ~ You may obtain a copy of the License at
  ~     http://www.apache.org/licenses/LICENSE-2.0
  ~ Unless required by applicable law or agreed to in writing, software
  ~ distributed under the License is distributed on an "AS IS" BASIS,
  ~ WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  ~ See the License for the specific language governing permissions and
  ~ limitations under the License.
  -->

# Health chip Storybook (design-review mock)

A plain HTML/CSS mock of the interpreter health UI, a **reference for mentees and design review**. The Angular
components in `src/app` are the source of truth; this mock can drift from them. The Angular application has no stories.

- PoC implementation of this design (ZEPPELIN-6577, ZEPPELIN-6578): branch
  [`poc/ZEPPELIN-6577-6578-interpreter-health-ui`](https://github.com/voidmatcha/zeppelin/tree/poc/ZEPPELIN-6577-6578-interpreter-health-ui)
  of `voidmatcha/zeppelin`, as the implementation, its edge cases and the redesign in separate commits.
- Stories: the paragraph footer chip (ZEPPELIN-6577) and the note Settings > Interpreter binding panel (ZEPPELIN-6578).
- The health dot is one SVG (`src/dot.js`) so that everything in it scales together.
- The chip tooltip is placed with Floating UI, not ng-zorro `nz-tooltip`, and follows the WAI-ARIA tooltip pattern.

```bash
npm ci
npm run storybook          # dev server on :6006
npm run build-storybook    # static build in storybook-static/
npm run test:storybook     # Playwright against storybook-static/ (build first)
```

A fork-only workflow (`.github/workflows/storybook.yml`) builds and tests it on every push and, when the repository variable
`STORYBOOK_PAGES_ENABLED` is `true`, publishes it to GitHub Pages under `storybook/branches/<branch>/`. Upstream keeps Storybook local.
