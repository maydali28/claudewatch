import { ipcMain, app } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok } from '@shared/ipc/contracts'

export function registerAppHandlers(): void {
  ipcMain.handle(CHANNELS.APP_GET_VERSION, () => ok(app.getVersion()))
}
