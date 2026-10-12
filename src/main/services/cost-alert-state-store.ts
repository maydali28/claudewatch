import * as fs from 'fs'
import * as path from 'path'
import type { CostAlertState, CostAlertStateStore } from './cost-alerts'

// Which cost alerts were announced, as one small JSON file beside the
// preferences, so a restart neither repeats an alert nor swallows one.

const FILE_NAME = 'cost-alert-state.json'
const FILE_VERSION = 1

interface FileShape extends CostAlertState {
  version: number
}

const empty = (): CostAlertState => ({ dailyFiredOn: null, sessionsFired: [] })

export function createCostAlertStateStore(dir: string): CostAlertStateStore {
  const filePath = path.join(dir, FILE_NAME)
  return {
    load() {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<FileShape>
        if (parsed.version !== FILE_VERSION) return empty()
        return {
          dailyFiredOn: typeof parsed.dailyFiredOn === 'string' ? parsed.dailyFiredOn : null,
          sessionsFired: Array.isArray(parsed.sessionsFired)
            ? parsed.sessionsFired.filter((id): id is string => typeof id === 'string')
            : [],
        }
      } catch {
        // No file yet, or unreadable: start empty rather than fail.
        return empty()
      }
    },
    save(state) {
      const shape: FileShape = { version: FILE_VERSION, ...state }
      const tmp = `${filePath}.tmp`
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(shape))
      fs.renameSync(tmp, filePath)
    },
  }
}
