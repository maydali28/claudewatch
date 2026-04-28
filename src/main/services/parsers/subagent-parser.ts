import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import type { RawRecord, SubagentSummary, ModelTokenBreakdown } from '@shared/types/session'
import type { ModelFamily, ModelPricing } from '@shared/types/pricing'
import { getModelFamily } from '@shared/constants/models'
import { estimateCost } from '@shared/constants/pricing'
import { isSyntheticAssistant, isToolResultCarrierUser, parseTokenUsage } from './parser-helpers'

/**
 * Discover and parse subagent transcripts written alongside a session.
 *
 * Subagents (Task tool) get their own JSONL files in
 * `<session>/subagents/agent-<id>.jsonl`. We aggregate per-agent token spend
 * so the parent session view can attribute costs accurately.
 */
export async function parseSubagents(
  sessionFilePath: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<SubagentSummary[]> {
  const sessionDir = sessionFilePath.replace(/\.jsonl$/, '')
  const subagentsDir = path.join(sessionDir, 'subagents')

  let files: string[]
  try {
    const entries = await fs.promises.readdir(subagentsDir, { withFileTypes: true })
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl') && !e.name.includes('compact'))
      .map((e) => e.name)
  } catch {
    return []
  }

  const results = await Promise.all(
    files.map((file) => parseSingleSubagent(path.join(subagentsDir, file), file, pricingTable))
  )
  return results.filter((s): s is SubagentSummary => s !== null)
}

async function parseSingleSubagent(
  filePath: string,
  fileName: string,
  pricingTable: Record<ModelFamily, ModelPricing>
): Promise<SubagentSummary | null> {
  const agentId = fileName.replace(/^agent-/, '').replace(/\.jsonl$/, '')

  let messageCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let estimatedCost = 0
  let firstTimestamp: string | undefined
  let lastTimestamp: string | undefined
  let primaryModel: string | undefined
  let maxTurnCount = 0
  const modelBreakdownMap = new Map<string, ModelTokenBreakdown>()

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.trim()) continue
      let raw: RawRecord
      try {
        raw = JSON.parse(line) as RawRecord
      } catch {
        continue
      }

      if (!firstTimestamp && raw.timestamp) firstTimestamp = raw.timestamp
      if (raw.timestamp) lastTimestamp = raw.timestamp

      if (raw.type === 'user' && !isToolResultCarrierUser(raw)) messageCount++
      if (raw.type === 'assistant' && !isSyntheticAssistant(raw)) {
        messageCount++

        const usage = parseTokenUsage(raw)
        totalInputTokens += usage.inputTokens
        totalOutputTokens += usage.outputTokens

        const model = raw.message?.model
        const family = getModelFamily(model)
        const cache5m = usage.cacheCreation?.ephemeral5mInputTokens ?? 0
        const cache1h = usage.cacheCreation?.ephemeral1hInputTokens ?? 0
        const turnCost = estimateCost(
          family,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadInputTokens,
          cache5m,
          cache1h,
          pricingTable
        )
        estimatedCost += turnCost

        if (model) {
          const existing = modelBreakdownMap.get(model)
          if (existing) {
            existing.inputTokens += usage.inputTokens
            existing.outputTokens += usage.outputTokens
            existing.cacheReadTokens += usage.cacheReadInputTokens
            existing.cacheCreation5mTokens += cache5m
            existing.cacheCreation1hTokens += cache1h
            existing.estimatedCost += turnCost
            existing.turnCount++
          } else {
            modelBreakdownMap.set(model, {
              model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadInputTokens,
              cacheCreation5mTokens: cache5m,
              cacheCreation1hTokens: cache1h,
              estimatedCost: turnCost,
              turnCount: 1,
            })
          }
          const count = modelBreakdownMap.get(model)!.turnCount
          if (count > maxTurnCount) {
            maxTurnCount = count
            primaryModel = model
          }
        }
      }
    }
  } catch {
    return null
  }

  if (messageCount === 0) return null

  return {
    agentId,
    messageCount,
    totalInputTokens,
    totalOutputTokens,
    primaryModel,
    firstTimestamp: firstTimestamp ?? '',
    lastTimestamp: lastTimestamp ?? '',
    estimatedCost,
    modelBreakdown: Array.from(modelBreakdownMap.values()),
  }
}
