import { z } from 'zod'
import { PRICED_FAMILIES } from '@shared/constants/pricing'
import type { ModelFamily } from '@shared/types/pricing'

// ─── Primitives ───────────────────────────────────────────────────────────────

const sessionId = z.string().uuid('sessionId must be a UUID')
const projectId = z.string().min(1).max(500)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

// ─── Date-range schema (mirrors DateRange union from analytics.ts) ─────────────

const DateRangePresetSchema = z.enum(['today', '7d', '30d', 'all'])

const CustomDateRangeSchema = z
  .object({
    preset: z.literal('custom'),
    from: isoDate,
    to: isoDate,
  })
  .refine((obj) => obj.from <= obj.to, { message: 'from date must be <= to date' })

const DateRangeSchema = z.union([DateRangePresetSchema, CustomDateRangeSchema])

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** sessions:list-projects  — no payload */
export const ListProjectsSchema = z.void()

/** sessions:get-summary-list */
export const GetSummaryListSchema = z.object({ projectId })

/** sessions:get-parsed */
export const GetParsedSchema = z.object({ sessionId, projectId })

/** sessions:get-subagent — the id is the `agent-<id>.jsonl` file's, so no path characters. */
export const GetSubagentSchema = z.object({
  sessionId,
  projectId,
  agentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'agentId must be a plain id'),
})

/** sessions:search */
export const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  projectIds: z.array(projectId).max(200).optional(),
})

/** sessions:tag */
export const TagSchema = z.object({
  sessionId,
  tags: z.array(z.string().min(1).max(100)).max(50),
})

/** sessions:export */
/** app:inspect-claude-dir */
export const InspectClaudeDirSchema = z.object({ path: z.string().trim().min(1).max(1000) })

/** app:set-claude-dir — null goes back to the environment and defaults. */
export const SetClaudeDirSchema = z.object({ path: z.string().trim().min(1).max(1000).nullable() })

/** secrets:dismiss — ids as the findings list gives them. */
export const SecretsDismissSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(1000),
})

export const ExportSchema = z.object({
  sessionId,
  projectId,
  format: z.enum(['json', 'csv', 'markdown']),
})

// ─── Analytics ────────────────────────────────────────────────────────────────

/** analytics:get */
export const AnalyticsGetSchema = z.object({
  dateRange: DateRangeSchema,
  projectIds: z.array(projectId).max(200).optional(),
})

// ─── Config ───────────────────────────────────────────────────────────────────

const OptionalProjectId = z.object({ projectId: projectId.optional() }).optional()

/** config:get-full / config:get-commands / config:get-mcps / config:get-memory */
export const ConfigProjectSchema = OptionalProjectId

// config:get-skills has no payload

// ─── Lint ─────────────────────────────────────────────────────────────────────

/** lint:run */
export const LintRunSchema = z.object({ projectId: projectId.optional() }).optional()

// lint:get-summary has no payload

// ─── Settings ─────────────────────────────────────────────────────────────────

const PricingProviderSchema = z.enum(['anthropic'])
const ThemeSchema = z.enum(['light', 'dark', 'system'])
const RedactionSchema = z.enum(['none', 'mask', 'remove'])

const WindowBoundsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
})

/** settings:set — partial patch; every key is optional */
// Strict: a key this schema does not list is rejected, not silently dropped.
// Dropping it made a setting look broken with no error anywhere (the window
// kept a value main never stored, then main pushed the old one back).
export const SettingsSetSchema = z
  .strictObject({
    pricingProvider: PricingProviderSchema,
    pricingOverrides: z.record(
      z.string(),
      z.object({
        input: z.number().nonnegative().optional(),
        output: z.number().nonnegative().optional(),
        cacheRead: z.number().nonnegative().optional(),
        cache5m: z.number().nonnegative().optional(),
        cache1h: z.number().nonnegative().optional(),
      })
    ),
    modelPreferences: z.record(
      z.string().trim().min(1).max(512),
      z.strictObject({
        family: z.enum(PRICED_FAMILIES as [ModelFamily, ...ModelFamily[]]).optional(),
        rates: z
          .strictObject({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
            cacheRead: z.number().nonnegative().optional(),
            cache5m: z.number().nonnegative().optional(),
            cache1h: z.number().nonnegative().optional(),
          })
          .optional(),
        displayName: z.string().max(80).optional(),
      })
    ),
    costAlertThreshold: z.number().nonnegative(),
    sessionCostAlertThreshold: z.number().nonnegative(),
    costAlertsEnabled: z.boolean(),
    dailyCostAlertEnabled: z.boolean(),
    sessionCostAlertEnabled: z.boolean(),
    costAlertNotify: z.boolean(),
    secretScanEnabled: z.boolean(),
    secretScanConsent: z.enum(['unasked', 'granted', 'declined']),
    secretScanNotify: z.boolean(),
    redactionLevel: RedactionSchema,
    launchAtLogin: z.boolean(),
    trayTipDismissed: z.boolean(),
    theme: ThemeSchema,
    sidebarWidth: z.number().int().min(160).max(600),
    windowBounds: WindowBoundsSchema,
    sentryEnabled: z.boolean(),
    lastSeenVersion: z.string().min(1).max(50),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Patch must not be empty' })

// ─── Plans ────────────────────────────────────────────────────────────────────

/** plans:list — no payload */
export const PlansListSchema = z.void()

/** plans:get — `id` is a `PlanSummary.id`, an absolute path; `plans-service.ts`'s
 * `readPlan` re-derives and validates it against the resolved plan directories,
 * this bound is defence in depth against an oversized payload. */
export const PlansGetSchema = z.object({ id: z.string().min(1).max(4096) })

// ─── Tray ─────────────────────────────────────────────────────────────────────

/** tray:open-dashboard — both fields optional, but if present must be valid */
export const TrayOpenDashboardSchema = z
  .object({ sessionId: sessionId.optional(), projectId: projectId.optional() })
  .optional()

/** tray:show-onboarding */
export const TrayShowOnboardingSchema = z.object({ launchAtLogin: z.boolean() })

// ─── Updates ──────────────────────────────────────────────────────────────────

// updates:check / updates:download / updates:install — all void

/** updates:resize-window — the renderer's measured content height, untrusted. */
export const UpdatesResizeSchema = z.object({ height: z.number().finite().min(0).max(10_000) })

// ─── Sentry ───────────────────────────────────────────────────────────────────

/** sentry:capture-exception — renderer forwards unhandled errors to main */
export const SentryCaptureExceptionSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(10000).optional(),
  origin: z.string().max(100),
})

// ─── Feedback ─────────────────────────────────────────────────────────────────

/** feedback:submit */
export const FeedbackSubmitSchema = z.object({
  name: z.string().max(100).optional().default(''),
  email: z
    .union([z.string().email().max(254), z.literal('')])
    .optional()
    .default(''),
  message: z.string().min(1).max(2000),
})

// ─── Helper: validate-or-throw ────────────────────────────────────────────────

/**
 * Parse `payload` with `schema` and return the typed value.
 * Throws a structured Error with a human-readable message on failure.
 * Used in every IPC handler so we never call services with untrusted data.
 */
export function validate<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`IPC validation failed — ${message}`)
  }
  return result.data
}
