// ─── Hooks ────────────────────────────────────────────────────────────────────

export interface HookCommand {
  type?: 'command'
  command: string
  timeout?: number
}

export interface HookRule {
  id: string
  matcher: string
  hooks: HookCommand[]
}

export interface HookEventGroup {
  id: string
  event: string
  rules: HookRule[]
}

// ─── MCP Servers ──────────────────────────────────────────────────────────────

export interface McpCapabilities {
  hasTools: boolean
  hasPrompts: boolean
  hasResources: boolean
  serverVersion?: { name: string; version: string }
}

export interface McpServerEntry {
  id: string
  name: string
  type?: 'stdio' | 'sse' | 'http' | string
  command?: string
  args: string[]
  url?: string
  env: Record<string, string>
  level?: 'global' | 'project' | 'local'
  status?: 'connected' | 'failed' | 'unknown'
  error?: string
  capabilities?: McpCapabilities
  lastSeen?: string
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface CommandEntry {
  id: string
  name: string
  description?: string
  content: string
  sizeBytes: number
}

// ─── Skills ───────────────────────────────────────────────────────────────────

export interface SkillEntry {
  id: string
  name: string
  displayName: string
  description?: string
  metadata: Record<string, string>
  body: string
  sizeBytes: number
}

// ─── Memory Files ─────────────────────────────────────────────────────────────

export interface MemoryFile {
  id: string
  label: string
  sublabel: string
  path: string
  content?: string
  sizeBytes?: number
}

// ─── Extended Config ──────────────────────────────────────────────────────────

export interface SandboxConfig {
  unsandboxedCommands: string[]
  enableWeakerNestedSandbox: boolean
}

export interface AttributionConfig {
  commitTemplate?: string
  prTemplate?: string
  hasDeprecatedCoAuthoredBy: boolean
}

export interface PluginInfo {
  name: string
  version?: string
  source?: string
}

export interface MarketplaceSource {
  name: string
  url?: string
}

export interface ClaudeProfile {
  name?: string
  email?: string
}

export interface ExtendedConfig {
  hooks: HookEventGroup[]
  sandbox?: SandboxConfig
  skipDangerousModePermissionPrompt: boolean
  disableSkillShellExecution: boolean
  attribution?: AttributionConfig
  plugins: PluginInfo[]
  marketplaces: MarketplaceSource[]
  profile?: ClaudeProfile
  allowedChannelPlugins?: string[]
  env?: Record<string, string>
}

// ─── Raw Settings.json ────────────────────────────────────────────────────────

export interface RawSettings {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: HookCommand[] } | HookCommand>>
  mcpServers?: Record<
    string,
    {
      type?: string
      command?: string
      args?: string[]
      url?: string
      env?: Record<string, string>
    }
  >
  permissions?: {
    allow?: string[]
    deny?: string[]
  }
  env?: Record<string, string>
  sandbox?: SandboxConfig
  skipDangerousModePermissionPrompt?: boolean
  disableSkillShellExecution?: boolean
  attribution?: AttributionConfig
  plugins?: PluginInfo[]
  marketplaces?: MarketplaceSource[]
  profile?: ClaudeProfile
  allowedChannelPlugins?: string[]
}
