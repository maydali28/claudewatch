import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FeatureFlags } from '@shared/constants/feature-flags'
import { DEFAULT_FEATURE_FLAGS } from '@shared/constants/feature-flags'

interface FeatureFlagsState extends FeatureFlags {
  setFlag<K extends keyof FeatureFlags>(flag: K, value: FeatureFlags[K]): void
  resetFlags(): void
}

export const useFeatureFlags = create<FeatureFlagsState>()(
  persist(
    (set) => ({
      ...DEFAULT_FEATURE_FLAGS,

      setFlag(flag, value) {
        set({ [flag]: value })
      },

      resetFlags() {
        set(DEFAULT_FEATURE_FLAGS)
      },
    }),
    { name: 'claudewatch-feature-flags' }
  )
)
