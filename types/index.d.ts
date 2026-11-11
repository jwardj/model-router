export type Tier = 'opus' | 'sonnet' | 'fable'
export type Mode = 'auto' | Tier
export type Pick = { tier: Tier; why: string }
/** Per model: how many tokens of this chat it had read at its last reply, and when (ms since epoch). */
export type Seen = Partial<Record<Tier, { tokens: number; at: number }>>

declare module 'claude-code' {
  interface PluginState {
    'model-router': { pick: Pick | null; mode: Mode; served: string | null; seen: Seen }
  }
}
