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
