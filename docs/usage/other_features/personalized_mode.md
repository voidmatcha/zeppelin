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

Currently, this feature is experimental. If you find any issues, please report them in 
[Apache Zeppelin JIRA](https://issues.apache.org/jira/browse/ZEPPELIN)

<div id="toc"></div>

## Live output limitation

Live paragraph append, update, replacement and checkpoint events do not identify
which user's execution produced them. These events are therefore ignored for
notes with an explicit `personalizedMode` setting. This includes `false`: an event
from a previous personal execution may arrive after switching back to shared mode.
Saving other note settings preserves an existing personalized-mode setting, even
when a stale client omits it. A warning is logged once per server instance when this restriction is encountered.

Shared notes without this setting continue to receive live output. This restriction
does not add execution ownership to the protocol or change terminal-result, Run All,
or Helium application behavior. Reliable personalized streaming requires a separate
execution-ownership change. Removing the setting while an interpreter may still emit
old output is not a safe workaround.
