import { ipcMain, app } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok } from '@shared/ipc/contracts'
import { getClaudeDir, getClaudeDirSource, describeClaudeDir } from '@main/lib/claude-paths'

export function registerAppHandlers(): void {
  ipcMain.handle(CHANNELS.APP_GET_VERSION, () => ok(app.getVersion()))

  ipcMain.handle(CHANNELS.APP_GET_PATHS, () =>
    ok({
      claudeDir: getClaudeDir(),
      display: describeClaudeDir(),
      source: getClaudeDirSource(),
    })
  )
}
