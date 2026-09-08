---
layout: page
title: "Personalized Mode"
description: ""
group: usage/other_features
---
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
{% include JB/setup %}

# What is Personalized Mode? 

Personalize your analysis result by switching the note to Personal Mode.

This enables two different users to change the view of the same paragraph's result with different view even owner change paragraph and run it again.

Wait for pending and running paragraphs, including whole-note executions, to finish before
switching modes. Switching back to collaborative mode discards the in-memory personalized
copies. In personalized mode, **Clear all output** clears only the requesting user's copies;
other users' results remain unchanged. After clearing output, refreshing the page preserves
the stream's output types so that later output can still be displayed. Clearing output during
execution clears the live display, not the interpreter's result. When execution finishes,
the final result can include output produced before the clear.

An explicit reload from notebook storage is deferred while the note has active executions.
Request another reload after execution finishes to pick up external repository changes.

Streaming output and checkpoints carry the user and mode captured when execution starts. Output whose
captured mode differs from the note's current mode is discarded, including delayed
asynchronous output and checkpoints after execution has finished.
After upgrading, restart existing interpreter processes so they use the matching
`zeppelin-interpreter-shaded` JAR. Older processes do not include the mode field: their streaming
output is accepted only for shared notes that have no explicit personalized-mode setting.
For notes with that setting, output without a mode field is discarded to prevent private output
from becoming shared after a mode change.

Currently, this feature is experimental. If you find any issues, please report them in 
[Apache Zeppelin JIRA](https://issues.apache.org/jira/browse/ZEPPELIN)

<div id="toc"></div>

