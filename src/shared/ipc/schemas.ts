import { z } from 'zod'

// ─── Primitives ───────────────────────────────────────────────────────────────

const sessionId = z.string().uuid('sessionId must be a UUID')
const projectId = z.string().min(1).max(500)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

// ─── Date-range schema (mirrors DateRange union from analytics.ts) ─────────────

const DateRangePresetSchema = z.enum(['today', '7d', '30d', '90d', 'all'])

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
export const ExportSchema = z.object({
  sessionId,
  projectId,
  format: z.enum(['json', 'csv', 'markdown']),
  outputPath: z.string().min(1).max(1000),
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

const PricingProviderSchema = z.enum(['anthropic', 'vertex-global', 'vertex-regional'])
const VertexRegionSchema = z.enum(['us-east5', 'europe-west1', 'asia-southeast1'])
const ThemeSchema = z.enum(['light', 'dark', 'system'])
const RedactionSchema = z.enum(['none', 'mask', 'remove'])

const WindowBoundsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
})

/** settings:set — partial patch; every key is optional */
export const SettingsSetSchema = z
  .object({
    pricingProvider: PricingProviderSchema,
    pricingRegion: VertexRegionSchema,
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
    costAlertThreshold: z.number().nonnegative(),
    secretScanEnabled: z.boolean(),
    redactionLevel: RedactionSchema,
    launchAtLogin: z.boolean(),
    trayTipDismissed: z.boolean(),
    theme: ThemeSchema,
    sidebarWidth: z.number().int().min(160).max(600),
    windowBounds: WindowBoundsSchema,
    alertedSecrets: z.array(z.string()).max(500),
    sentryEnabled: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Patch must not be empty' })

// ─── Plans ────────────────────────────────────────────────────────────────────

// `path.basename` is applied inside the handler; we still bound the input length
// and ensure no path separators slip through here as defence in depth.
const planFilename = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[^/\\]+\.md$/, 'plan filename must be a .md file with no path separators')

const planSlug = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9._-]+$/, 'slug must be alphanumeric / dot / dash / underscore')

/** plans:list — no payload */
export const PlansListSchema = z.void()

/** plans:get */
export const PlansGetSchema = z.object({ filename: planFilename })

/** plans:get-projects */
export const PlansGetProjectsSchema = z.object({ slug: planSlug })

// ─── Tray ─────────────────────────────────────────────────────────────────────

/** tray:open-dashboard — both fields optional, but if present must be valid */
export const TrayOpenDashboardSchema = z
  .object({ sessionId: sessionId.optional(), projectId: projectId.optional() })
  .optional()

/** tray:show-onboarding */
export const TrayShowOnboardingSchema = z.object({ launchAtLogin: z.boolean() })

// ─── Updates (no payload on any channel) ─────────────────────────────────────

// updates:check / updates:download / updates:install — all void

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
