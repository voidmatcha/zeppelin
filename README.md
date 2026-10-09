<!--
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
 -->

# Assistant design reference

A simplified HTML/CSS Storybook for implementing Zeppelin Assistant screens.
This fork preview contains no React, Ant Design, SDK, notebook core or server.
All 46 original stories retain their IDs and rendered light/dark designs.
The HTML and CSS are snapshots of the validated implementation, not redesigned
examples. This is a visual reference, not a working Assistant.
The original 46 screens are static references. Interactive demo / Conversation
previews sending, streaming, earlier history, conversation search,
read-only selection, and deletion of owned conversations with local fixture
data. It does not retain separate transcripts or drafts across conversation
switches. Interactive demo /
Planned approval illustrates edit approval, skipping and separate execution
approval. These examples make no server requests or real notebook changes.
Looping flows replay the four current and two planned recordings from start to
finish, including the notebook canvas. After the final state they restart.
The planned approval flow is a visual fixture and changes no notebook.
The loading reference preserves the rendered Ant Design Skeleton markup/styles.

## View and inspect

https://voidmatcha.github.io/zeppelin/?path=/story/assistant-panel--history

Start with `Assistant / 00 Work packages / Overview`. Its five proposed work
packages map to existing stories, HTML examples, shared CSS, ownership
boundaries, and completion criteria. The guides do not change the original story
URLs or screen designs. Packages 01 and 02 build the display and controls;
03 assembles the panel; 04 mounts it in the notebook; 05 verifies the full flow.
The approval demos are labeled Future and are outside these five packages.

The complete markup is in `public/screens/` and CSS in `public/reference.css`.
`public/stories.json` lists every original story. The original component groups
retain every individual example.
Light and dark themes are selectable from the toolbar.

## Use without Storybook

Download `public/design-reference.zip` or use the checked-in HTML/CSS. All 92
light/dark reference pages are in `examples/`; use them with `reference.css`
and the included fonts. They need no JavaScript. `examples/conversation-light.html`
and `examples/approval-light.html` add fixture interaction through `demo.js`.
`examples/loop-ask-light.html` and the other `loop-*` pages run the complete
repeating flows using `flow.js`, `flow.css`, and the same snapshot DOM/CSS.
Serve the extracted directory with `python3 -m http.server` for these ES modules.
Copy a page’s DOM and the CSS together; class names and CSS variables are
preserved from the original rendered screens rather than redesigned.

## Run

Use Node from `.nvmrc`.

```sh
npm ci
npm run storybook
```

## Verify and publish

```sh
npm run build:storybook
npx playwright install chromium
npm run test:storybook
```

Pushes to `voidmatcha/assistant-storybook-share` build, browser-test and deploy
this fork preview to GitHub Pages. Other PR branches are unchanged.

## License

Apache License 2.0; see LICENSE and NOTICE. Storybook and Vite are MIT licensed;
Playwright is Apache-2.0 licensed. Storybook and Vite license notices are also published as
`LICENSE-storybook` and `LICENSE-vite.md`.
