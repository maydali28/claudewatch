// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Which settings file a value came from. Precedence, lowest to highest:
 * `user` (`<claudeDir>/settings.json`) < `project` (`<root>/.claude/settings.json`)
 * < `local` (`<root>/.claude/settings.local.json`).
 *
 * There is deliberately no `user-local`. Claude Code's scopes are managed,
 * project-local, shared project and user; `<claudeDir>/settings.local.json` is
 * not a fifth one. It is only the project-local file of a project whose root
 * happens to be the home directory, and it is read as that project's `local`
 * layer — once.
 */
export type ConfigScope = 'user' | 'project' | 'local'

// ─── Sources ──────────────────────────────────────────────────────────────────

/** Where a hook, command or skill comes from. `local` items group with their project. */
export type ConfigSourceKind = 'user' | 'project' | 'local' | 'plugin' | 'managed' | 'builtin'

export interface PluginRef {
  name: string
  /** `name@marketplace` key of a marketplace install; absent for claude.ai-synced plugins. */
  marketplace?: string
  version?: string
  origin: 'marketplace' | 'claude.ai'
  /** Enabled in `enabledPlugins` (claude.ai-synced plugins are always enabled). */
  enabled: boolean
  /** False for a plugin known only from session skill listings, no longer installed. */
  installed?: false
}

export interface ConfigSource {
  kind: ConfigSourceKind
  /** 'user' · 'project:<projectId>' · 'local:<projectId>' · 'plugin:<name>@<marketplace>' · 'managed' · 'builtin' */
  id: string
  /** 'Global' · project name · plugin name · 'Managed' · 'Built-in' */
  label: string
  /** Folder the items are read from (absent for built-in). */
  root?: string
  projectId?: string
  projectName?: string
  plugin?: PluginRef
}

export interface HookCommand {
  type?: 'command'
  command: string
  timeout?: number
  statusMessage?: string
}

/** A settings scope, or a hook that comes from a plugin or the managed settings file. */
export type HookScope = ConfigScope | 'plugin' | 'managed'

/**
 * Why Claude Code will not run a rule ClaudeWatch still lists: its plugin is
 * disabled, or managed settings set `allowManagedHooksOnly`.
 */
export type HookInactiveReason = 'plugin-disabled' | 'managed-only'

export interface HookRule {
  id: string
  matcher: string
  hooks: HookCommand[]
  scope: HookScope
  /** Absolute path of the settings or hooks file the rule came from. */
  sourcePath: string
  source: ConfigSource
  inactiveReason?: HookInactiveReason
  projectId?: string
  projectName?: string
}

/** A project whose real filesystem root is known (from a transcript `cwd`), never a decoded guess. */
export interface ProjectRootRef {
  id: string
  name: string
  path: string
}

/** One settings file that exists on disk, with the scope it was read as. */
export interface SettingsLayer {
  scope: ConfigScope
  path: string
  settings: RawSettings
  project?: ProjectRootRef
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

/** Commands come from the user folder, a project's folder or a plugin — there is no local commands directory. */
export type CommandScope = 'user' | 'project' | 'plugin'

/** One entry of a command's frontmatter `arguments` list. */
export interface CommandArgument {
  name: string
  description?: string
  required?: boolean
}

export interface CommandEntry {
  id: string
  name: string
  description?: string
  content: string
  sizeBytes: number
  scope: CommandScope
  source: ConfigSource
  /** Absolute path of the command's markdown file. */
  filePath: string
  arguments?: CommandArgument[]
  /** The command's plugin is disabled, so Claude Code does not offer it. */
  inactive?: true
  projectId?: string
  projectName?: string
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
  /** Set on every skill the Skills panel lists; absent on a project's raw `localSkills`. */
  source?: ConfigSource
  /** Absolute path of the `SKILL.md`, when there is one. */
  filePath?: string
  /** Known only from sessions' skill listings: no file, so no body (built-in, claude.ai, …). */
  sessionOnly?: true
  /** A command Claude Code also offers as a skill. */
  exposedAs?: 'command'
  /** Last time a session listed this skill (the session's last timestamp). */
  lastSeen?: string
  /** How many scanned sessions listed this skill. */
  sessionCount?: number
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
  plansDirectory?: string
  /** `{"name@marketplace": true|false}` */
  enabledPlugins?: Record<string, boolean>
  /** Managed settings only: when true, Claude Code runs managed hooks and no others. */
  allowManagedHooksOnly?: boolean
}
