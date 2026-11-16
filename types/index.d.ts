export type Tier = 'opus' | 'sonnet' | 'fable'
export type Mode = 'auto' | Tier
/** `low`: a chore, answered at low effort whichever model ends up with it. */
export type Pick = { tier: Tier; why: string; low?: true }
/** Per model: how many tokens of this chat it had read at its last reply, and when (ms since epoch). */
export type Seen = Partial<Record<Tier, { tokens: number; at: number }>>

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      pick: Pick | null
      mode: Mode
      served: string | null
      seen: Seen
      /** The new task whose first reply is to be followed by a compaction of the old chat. */
      compactAfter: string | null
      /** A compaction has been asked for and the chat has not yet come back smaller. */
      compacting: boolean
    }
  }
}
