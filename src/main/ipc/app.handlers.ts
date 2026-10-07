import { BrowserWindow, dialog, ipcMain, app } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { validate, InspectClaudeDirSchema, SetClaudeDirSchema } from '@shared/ipc/schemas'
import {
  getClaudeDir,
  getClaudeDirSource,
  describeClaudeDir,
  resolveClaudeDirWithoutAppSetting,
} from '@main/lib/claude-paths'
import { changeClaudeDir, inspectClaudeDir } from '@main/services/claude-dir-service'
import { captureHandlerException } from '@main/services/sentry'

export function registerAppHandlers(): void {
  ipcMain.handle(CHANNELS.APP_GET_VERSION, () => ok(app.getVersion()))

  ipcMain.handle(CHANNELS.APP_GET_PATHS, () => {
    const fallback = resolveClaudeDirWithoutAppSetting()
    return ok({
      claudeDir: getClaudeDir(),
      display: describeClaudeDir(),
      source: getClaudeDirSource(),
      fallback: { claudeDir: fallback.dir, source: fallback.source },
    })
  })

  ipcMain.handle(CHANNELS.APP_INSPECT_CLAUDE_DIR, async (_event, payload) => {
    try {
      const { path } = validate(InspectClaudeDirSchema, payload)
      return ok(await inspectClaudeDir(path))
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CLAUDE_DIR_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.APP_CHOOSE_CLAUDE_DIR, async (event) => {
    try {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose the Claude folder',
        defaultPath: getClaudeDir(),
        properties: ['openDirectory', 'showHiddenFiles'],
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const choice = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (choice.canceled || !choice.filePaths[0]) return ok(null)
      return ok(await inspectClaudeDir(choice.filePaths[0]))
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CLAUDE_DIR_FAILED')
    }
  })

  ipcMain.handle(CHANNELS.APP_SET_CLAUDE_DIR, async (_event, payload) => {
    try {
      const { path } = validate(SetClaudeDirSchema, payload)
      await changeClaudeDir(path)
      return ok(undefined)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CLAUDE_DIR_FAILED')
    }
  })
}
