## 1.5.3 (2026-09-22)


### Features

* **commands:** show command bodies as markdown with a raw toggle
## 1.5.2 (2026-09-22)


### Features

* **sessions:** collapse long messages behind a show more control

### Bug Fixes

* **sessions:** hide redacted thinking blocks in the transcript
* **sessions:** show each response as one message in the transcript
## 1.5.1 (2026-09-17)

> **User message counts drop, and cached session data is rebuilt on first
> launch.** Background-task notices, sub-agent reports, injected context and
> local commands were counted as messages you wrote; only your own prompts
> count now, and those other records appear as their own cards in the
> conversation. Costs are labelled as estimates throughout. Live secret
> scanning is switched off until its alert ships. Crash reports no longer
> send app-session records, turning them off also discards reports queued
> while offline, and turning them on takes effect after a restart.
> Installing 1.5.1 over 1.5.0 still runs 1.5.0's updater: if you cancel the
> macOS password prompt, quit and reopen ClaudeWatch before trying again.
> Updates from 1.5.1 onward recover on their own.

### Bug Fixes

* **analytics:** label every cost as an estimate and explain what it is not
* **analytics:** say which usage the estimate leaves out, such as fast mode or web searches
* **analytics:** stop rescanning in a loop when there are no projects
* **commands:** list each project's .claude/commands, including namespaced ones
* **config:** group hooks, commands and plans under global and each project
* **config:** honour a relocated claude config folder and resolve every path through one helper
* **config:** list skills, hooks and commands once when a project is your home folder
* **hooks:** read project and local settings files and keep hooks from every scope
* **hooks:** show project and local hooks with their scope and source file
* **plans:** honour the plans directory setting and show where each plan lives
* **privacy:** describe crash reports and feedback accurately in settings
* **privacy:** hide your username in crash reports on every platform and send no memory dumps
* **privacy:** never send queued crash reports after you turn reporting off
* **privacy:** say when feedback cannot be sent until a restart
* **privacy:** send no usage sessions with crash reports and describe what a report contains
* **privacy:** send nothing after crash reports are switched back off before a restart
* **privacy:** stop scanning transcripts for secrets until the alert and toggle ship
* **sessions:** count only messages you wrote as user messages
* **sessions:** show sub-agent reports and background task notices as their own cards
* **sessions:** show the error when a conversation fails to load and recover when its file is deleted
* **updates:** keep the app running after an install is cancelled instead of half-quitting
* **updates:** point linux users to apt or the download page instead of a failing button
* **updates:** report install failures and allow a retry after a cancelled password prompt
* **updates:** show a clear install error with a working retry and block double installs
* **updates:** size the update window to its content instead of a fixed 520×640
## 1.5.0 (2026-09-16)

> **Sessions now show their generated names, and cached session data is
> rebuilt on first launch.** Sessions were listed by a slug or a bare id;
> they now carry the name Claude Code generates for them, in the session
> list, the tray, analytics and search. Reading those names re-parses every
> cached session once, so the first start after updating takes longer than
> usual. Conversations now open on the newest message and load older ones
> as you scroll up, instead of opening on the first message.

### Features

* **sessions:** open conversations at the newest message and load older ones on scroll up

### Bug Fixes

* **analytics:** format token counts at billion and trillion scale
* **analytics:** hide projects with no activity in the selected range
* **analytics:** show every day in the selected range, including idle ones
* **export:** count subagent usage conflicts in full-session diagnostics
* **export:** export each response's resolved usage, not its first snapshot
* **sessions:** keep the live indicator on while a turn is still running
* **sessions:** show a live session whose project the dashboard has not loaded yet
* **sessions:** show a live update to the tray while a rescan is running
* **sessions:** show generated session names instead of slugs or ids
* **sessions:** show one entry per project instead of one per worktree
* **sessions:** show the generated session name in the conversation header
* **tray:** drop finished sessions from the live list without waiting for a poll
## 1.4.0 (2026-09-15)

> **Cache savings figures will drop, and cached session data is rebuilt on
> first launch.** Cache savings ignored the premium paid to write the cache,
> so the reported figure was too high; it is now reads saved minus that
> premium and can legitimately show a loss where caching did not pay for
> itself. Session details counted one API response as several messages, so
> its figures disagreed with the list beside it. Usage that could not be
> read — a missing counter, an unparsable timestamp — is now reported as
> such instead of silently counting as zero.

### Features

* **sessions:** surface thinking, effort, service tiers and usage conflicts

### Bug Fixes

* **accounting:** count usage once per api response, not once per record
* **accounting:** validate and price every response's usage consistently
* **analytics:** correct cache savings and say what each number measures
* **analytics:** scope every figure to the period you selected
* **export:** carry usage completeness into json, csv and markdown
* **lint:** keep message thresholds selecting the same sessions
* **pricing:** reprice cached sessions when you change a rate
* **sessions:** keep caches and live updates consistent with the files
* **sessions:** order and date every list by time, not by text
* **sessions:** show logical messages, effort and subagent activity
## 1.3.0 (2026-09-13)

> **Your reported costs will drop, and historical charts will change shape.**
> Usage was counted once per transcript record rather than once per API
> response, so totals were overstated — measured at about 2.4x across a full
> local history. Usage is also attributed to the day it actually happened
> instead of to each session's last active day, so past days that previously
> showed nothing now show their real figures. Cached session data is rebuilt
> automatically on first launch.

### Features

* **accounting:** count usage once per api response
* **analytics:** drop the 90-day range option

### Bug Fixes

* **accounting:** correct session totals, subagent rollup and model badge
* **analytics:** count only the turns that happened in the selected period
* **analytics:** label model charts with their model names again
* **analytics:** make every tab report the period you selected
* **analytics:** price cache savings per model and compare real days
* **analytics:** put usage on the day it actually happened
* **analytics:** scope project costs to the selected period
* **lint-rules:** repair two rules that silently never ran
* **pricing:** recognise current models and refuse to price unknown ones
* **pricing:** refresh cached costs when rates change
* **sessions:** correct the token and cost figures in session details
* **sessions:** show the model a session is currently on
* **types:** clear the 22 errors the working typecheck exposed
* **watcher:** log a failed re-parse instead of crashing the app

### Performance Improvements

* **accounting:** parse transcripts off the main thread
* **sessions:** only render the part of a transcript you have reached
* **tray:** stop rescanning every transcript to open the popover
## 1.2.10 (2026-09-13)


### Bug Fixes

* **update:** listen for the update quit on the emitter that sends it
## 1.2.9 (2026-09-13)


### Bug Fixes

* **update:** show real download progress in the update window
## 1.2.8 (2026-09-13)


### Bug Fixes

* **update:** exit the tray app so shipit can finish the install
## 1.2.7 (2026-09-13)


### Bug Fixes

* **tooling:** do not block a tag when develop only differs by a merge
* **tooling:** only block a tag when a shipping file differs
## 1.2.6 (2026-09-13)


### Bug Fixes

* **update:** quit on before-quit-for-update so the install can proceed
## 1.2.5 (2026-09-13)


### Bug Fixes

* **update:** write file names, not urls, in the update manifests
## 1.2.4 (2026-09-13)


### Dependencies

* update 49 dependency ranges within their current majors
* runtime: @sentry/electron 7.18.0, zod 4.6.4, semver 7.8.5

## 1.2.3 (2026-09-13)


### Bug Fixes

* **update:** ship app-update.yml so downloads can start
## 1.2.2 (2026-09-13)


### Bug Fixes

* **tooling:** do not gate tag deletions in the release check
* **update:** stop offering an update to the installed version
* **update:** strip release-note markup completely
## 1.2.1 (2026-09-13)


### Bug Fixes

* **deps:** clear the 12 tar advisories, verified against a real package build
* **update:** point the updater at github releases, not the hazel server
## 1.2.0 (2026-09-13)


### Features

* **update:** switch macos auto-update to electron-updater
## 1.1.2 (2026-06-29)


### Features

* add fable and opus 4.8 models
* add mac os app signin to release pipeline ([#23](https://github.com/maydali28/claudewatch/issues/23))

### Bug Fixes

* fix circular deps
* fix project name in different tabs
* fix tray misclick and autostart for each platform ([#22](https://github.com/maydali28/claudewatch/issues/22))
## 1.1.0 (2026-05-29)


### Features

* add mac os app signing to release pipeline

### Bug Fixes

* fix tray misclick and autostart for each platform
## 1.0.0 (2026-05-01)


### Features

* first version of claude code session explorer
