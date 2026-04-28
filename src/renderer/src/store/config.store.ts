import { create } from 'zustand'
import type {
  HookEventGroup,
  CommandEntry,
  SkillEntry,
  McpServerEntry,
  MemoryFile,
  ExtendedConfig,
} from '@shared/types'
import type { ProjectSkillEntry, ProjectClaudeMd } from '@shared/types/project'
import { ipc } from '@renderer/lib/ipc-client'

interface ConfigState {
  hooks: HookEventGroup[]
  commands: CommandEntry[]
  skills: SkillEntry[]
  projectSkills: ProjectSkillEntry[]
  mcps: McpServerEntry[]
  memoryFiles: MemoryFile[]
  projectClaudeMds: ProjectClaudeMd[]
  extendedConfig: ExtendedConfig | null
  isLoading: boolean
  hasLoaded: boolean
  error: string | null

  selectedCommandId: string | null
  selectedSkillId: string | null
  selectedMcpId: string | null
  selectedMemoryId: string | null
  selectedHookId: string | null

  loadAll(projectId?: string): Promise<void>
  setSelectedCommand(id: string | null): void
  setSelectedSkill(id: string | null): void
  setSelectedMcp(id: string | null): void
  setSelectedMemory(id: string | null): void
  setSelectedHook(id: string | null): void
}

export const useConfigStore = create<ConfigState>((set) => ({
  hooks: [],
  commands: [],
  skills: [],
  projectSkills: [],
  mcps: [],
  memoryFiles: [],
  projectClaudeMds: [],
  extendedConfig: null,
  isLoading: false,
  hasLoaded: false,
  error: null,

  selectedCommandId: null,
  selectedSkillId: null,
  selectedMcpId: null,
  selectedMemoryId: null,
  selectedHookId: null,

  async loadAll(projectId) {
    set({ isLoading: true, hasLoaded: false, error: null })
    try {
      const [
        fullResult,
        commandsResult,
        skillsResult,
        projectSkillsResult,
        mcpsResult,
        memoryResult,
        projectClaudeMdsResult,
      ] = await Promise.all([
        ipc.config.getFull(projectId),
        ipc.config.getCommands(projectId),
        ipc.config.getSkills(),
        ipc.config.getProjectSkills(),
        ipc.config.getMcps(projectId),
        ipc.config.getMemory(projectId),
        ipc.config.getProjectClaudeMds(),
      ])

      set({
        extendedConfig: fullResult.ok ? fullResult.data : null,
        hooks: fullResult.ok ? (fullResult.data.hooks ?? []) : [],
        commands: commandsResult.ok ? commandsResult.data : [],
        skills: skillsResult.ok ? skillsResult.data : [],
        projectSkills: projectSkillsResult.ok ? projectSkillsResult.data : [],
        mcps: mcpsResult.ok ? mcpsResult.data : [],
        memoryFiles: memoryResult.ok ? memoryResult.data : [],
        projectClaudeMds: projectClaudeMdsResult.ok ? projectClaudeMdsResult.data : [],
        hasLoaded: true,
      })
    } catch (err) {
      set({ error: String(err) })
    } finally {
      set({ isLoading: false })
    }
  },

  setSelectedCommand: (id) => set({ selectedCommandId: id }),
  setSelectedSkill: (id) => set({ selectedSkillId: id }),
  setSelectedMcp: (id) => set({ selectedMcpId: id }),
  setSelectedMemory: (id) => set({ selectedMemoryId: id }),
  setSelectedHook: (id) => set({ selectedHookId: id }),
}))
