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
