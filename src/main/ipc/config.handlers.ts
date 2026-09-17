import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { ok, err, toSafeError } from '@shared/ipc/contracts'
import { captureHandlerException } from '@main/services/sentry'
import { validate, ConfigProjectSchema } from '@shared/ipc/schemas'

import {
  readExtendedConfig,
  readCommands,
  readSkills,
  readMcps,
  readMemoryFiles,
} from '@main/services/config-service'
import { resolvedProjectRoots } from '@main/services/project-roots'
import { getOrScanProjects } from './sessions.handlers'

// Defined in services so lint-service can share it without importing IPC code.
export { resolvedProjectRoots }

function validateProjectScopedRequest(payload: unknown): { projectId?: string } | undefined {
  return validate(ConfigProjectSchema, payload) as { projectId?: string } | undefined
}

export function registerConfigHandlers(): void {
  ipcMain.handle(CHANNELS.CONFIG_GET_FULL, async (_event, payload) => {
    try {
      const projectScope = validateProjectScopedRequest(payload)
      const projectId = projectScope?.projectId
      const roots = await resolvedProjectRoots()
      const extendedConfig = await readExtendedConfig(
        projectId ? roots.filter((r) => r.id === projectId) : roots
      )
      return ok(extendedConfig)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })

  ipcMain.handle(CHANNELS.CONFIG_GET_COMMANDS, async (_event, payload) => {
    try {
      const projectScope = validateProjectScopedRequest(payload)
      const projectId = projectScope?.projectId
      const roots = await resolvedProjectRoots()
      const commands = await readCommands(
        projectId ? roots.filter((r) => r.id === projectId) : roots
      )
      return ok(commands)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })

  ipcMain.handle(CHANNELS.CONFIG_GET_SKILLS, async () => {
    try {
      const skills = await readSkills()
      return ok(skills)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })

  ipcMain.handle(CHANNELS.CONFIG_GET_MCPS, async (_event, payload) => {
    try {
      const projectScope = validateProjectScopedRequest(payload)
      const projectId = projectScope?.projectId
      const root = projectId
        ? (await resolvedProjectRoots()).find((r) => r.id === projectId)
        : undefined
      const mcps = await readMcps(root)
      return ok(mcps)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })

  ipcMain.handle(CHANNELS.CONFIG_GET_MEMORY, async (_event, payload) => {
    try {
      const projectScope = validateProjectScopedRequest(payload)
      const projectId = projectScope?.projectId
      const root = projectId
        ? (await resolvedProjectRoots()).find((r) => r.id === projectId)
        : undefined
      const memoryFiles = await readMemoryFiles(projectId, root)
      return ok(memoryFiles)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })

  ipcMain.handle(CHANNELS.CONFIG_GET_PROJECT_SKILLS, async () => {
    try {
      const projects = await getOrScanProjects()
      const projectSkillEntries = projects.flatMap((project) =>
        project.localSkills.map((skill) => ({
          ...skill,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
        }))
      )
      return ok(projectSkillEntries)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })

  ipcMain.handle(CHANNELS.CONFIG_GET_PROJECT_CLAUDE_MDS, async () => {
    try {
      const projects = await getOrScanProjects()
      const projectClaudeMdEntries = projects
        .filter((project) => project.localClaudeMd !== null)
        .map((project) => ({
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          filePath: `${project.path}/CLAUDE.md`,
          content: project.localClaudeMd!,
          sizeBytes: Buffer.byteLength(project.localClaudeMd!, 'utf-8'),
        }))
      return ok(projectClaudeMdEntries)
    } catch (e) {
      captureHandlerException(e)
      return err(toSafeError(e), 'CONFIG_READ_ERROR')
    }
  })
}
