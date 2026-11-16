import type { Seen, Tier } from '../types'

// The prompt cache is per model: a model that has not read this chat pays for all of it again (about
// 125% of its input price), while the model that just answered re-reads it at about 10%.
// 1 hour is this app's normal cache lifetime; it drops to 5 minutes in usage overage. Tune here.
export const CACHE_TTL_MS = 60 * 60_000
// Below this many tokens to re-read, a switch costs next to nothing.
export const SMALL_REREAD_TOKENS = 10_000

const COST: Record<Tier, number> = { sonnet: 0, opus: 1, fable: 2 }

/**
 * A move to a cheaper model only saves anything if the re-read is small. Keeps the model whose cache
 * is warm when the pick is cheaper and would have to re-read a big chat; moves up are never held back.
 * `seen` is, per model, how much of the chat it had read and when.
 */
export function keepWarm(chosen: Tier, seen: Seen, now: number): Tier {
  const live = (Object.entries(seen) as [Tier, { tokens: number; at: number }][])
    .filter(([, s]) => now - s.at < CACHE_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
  const cur = live[0]
  if (!cur || COST[chosen] >= COST[cur[0]]) return chosen
  // ponytail: assumes the chat only grows; after a compaction this can under-count the re-read once.
  const reread = cur[1].tokens - (live.find(([t]) => t === chosen)?.[1].tokens ?? 0)
  return reread < SMALL_REREAD_TOKENS ? chosen : cur[0]
}

// A chat this big carries its whole history on every request, so a new task in it is the moment to compact:
// right after the new task's first reply, the earliest the engine allows. Infinity turns that off.
export const COMPACT_ABOVE_TOKENS = 150_000

/** The model that read this chat last, how much of it and when; undefined in a new chat. */
export function lastSeen(seen: Seen): { tier: Tier; tokens: number; at: number } | undefined {
  return (Object.entries(seen) as [Tier, { tokens: number; at: number }][])
    .map(([tier, s]) => ({ tier, ...s }))
    .sort((a, b) => b.at - a.at)[0]
}

/**
 * What a follow-up inherits: the last pick, except Fable once the cache has lapsed. A cold chat is re-read at
 * full price whichever model answers, and Opus does that for half of what Fable does. Fable by name still works.
 */
export function inherited(prev: Tier | undefined, seen: Seen, now: number): Tier | undefined {
  const last = lastSeen(seen)
  return prev === 'fable' && last && now - last.at >= CACHE_TTL_MS ? 'opus' : prev
}

/**
 * Whether to compact before a new task. The engine compacts on the session's own model (the one selected in the
 * app), not the routed one (measured 2026-11-16), so this only pays when that is the model answering next: either
 * its cache is the warm one, or the re-read is one it was about to pay for anyway. On any other model the summary
 * re-reads the whole chat at full price, which costs more than the compaction saves.
 */
export function shouldCompact(seen: Seen, sessionModel: string, next: Tier): boolean {
  return (lastSeen(seen)?.tokens ?? 0) >= COMPACT_ABOVE_TOKENS && sessionModel.toLowerCase().includes(next)
}

/** What the summary is told when a new task has just had its first reply in a big chat. */
export const compactInstructions = (task: string) =>
  `The latest request started a new task, unrelated to the chat before it: "${task}". Keep the work on that request ` +
  'in full detail. Summarize everything before it briefly: what was done, the files involved and their paths, and ' +
  'anything left unfinished.'

export const NEW_TASK_LABELS = ['same work', 'new task'] as const
/** Asks whether `now` starts something unrelated to `before`, the request before it in the chat. */
export const newTaskPrompt = (before: string, now: string) =>
  'Two requests a student made in one chat with an AI assistant, in order. Does the second continue the same work ' +
  '(a correction, a next step, a question about it) or start a new, unrelated task?\n\n' +
  `First request:\n${before.slice(0, 1000)}\n\nSecond request:\n${now.slice(0, 2000)}`

// Asking for Fable by name wins over everything ("use fable", "have fable do this", "fable: ...", "with claude fable").
// The model is a bare "fable" right after a verb; the story has an article ("a fable", "my favorite fable"),
// so "write a fable for English" is still writing. "want/need fable" only counts before to/for/on.
const FABLE = /\b(use|using|with|via|switch to|route to|answer with|have|ask|let|can|could|should)\s+(claude[\s-]+)?fable\b|\b(want|need)\s+(claude[\s-]+)?fable\s+(to|for|on)\b|^\s*fable\b\s*[:,-]|\bclaude[\s-]+fable\b|\bfable\s+5(\.2)?\b/i

// Parts of an app: adding one of these is coding ("add a dark mode to the dashboard"), not a quick add.
const UI = 'mode|feature|button|page|tab|chart|graph|widget|panel|toggle|theme|filter'

// Anything that needs real thinking, careful output or the web goes to Opus.
// Web work always goes to Opus, even inside a chore ("look up X and add a reminder").
const WEB: [RegExp, string][] = [
  [/\b(browse|browser|web ?search|search the web|look ?up|google it|website|chrome|online)\b/i, 'web browsing'],
]

const OPUS: [RegExp, string][] = [
  [/\b(worksheet|ipad|homework|hw|problem set|pset)\b/i, 'worksheet / homework'],
  [/\b(research|compare|analy[sz]e|explain|why does|derive|prove|solve|study guide)\b/i, 'research / reasoning'],
  [/\b(ece ?\d{3}|signals?|circuit|ltspice|fourier|laplace|convolution|probability|statistics)\b/i, 'engineering coursework'],
  [/\b(build|code|debug|fix (the|my) (bug|code|script)|script|mod|plugin|dashboard (feature|redesign)|redesign)\b/i, 'building / coding'],
  [new RegExp(`\\badd .{0,30}\\b(${UI})\\b`, 'i'), 'building / coding'],
  [/\b(essay|paper|resume|cover letter|application|personal statement|draft|write (a|an|me))\b/i, 'writing'],
  [/\b(slides?|deck|presentation|spreadsheet|report|pdf)\b/i, 'document building'],
]

// Clear chore actions: these win over real-work words ("add a reminder for my lab report").
// "remind me how convolution works" asks for an explanation, and adding a part of an app is coding: neither is a chore.
const CHORE: [RegExp, string][] = [
  [new RegExp(`\\b(remind(er)?(?! me (how|what|why|who|which)\\b)|add (?!.{0,30}\\b(${UI})\\b).{0,30}(to|on) (the |my )?(dashboard|calendar|tasks?|list))\\b`, 'i'), 'reminder / quick add'],
  [/\b(calendar event|schedule (a|an)|move (my|the) .{0,20}(to|from)|reschedule)\b/i, 'calendar chore'],
  [/\b(mark .{0,20}(done|complete)|check off|cross off)\b/i, 'quick edit'],
]

// Weak chore hints: only count when no real-work word fired ("is this code ok" is coding).
const WEAK_CHORE: [RegExp, string][] = [
  [/\b(rename|delete)\b/i, 'quick edit'],
  [/\b(what time|when is|how many days|what's due|whats due)\b/i, 'quick question'],
  [/\b(typo|spelling|reword this sentence)\b/i, 'tiny fix'],
]

// Weakest of all: "thanks!" is a chore, but "ok now make it handle negatives" keeps going, so it continues the task.
const ACK = /\b(thanks|thank you|ok|okay|cool)\b/i

// "continue", "yes", "do it": a follow-up belongs to whatever task came before it.
const FOLLOW_UP = /\b(continue|keep going|go on|go ahead|carry on|proceed|resume|do it|do that|try again|finish( it)?|yes|yeah|yep|sure|sounds good)\b/i

// Chores are short; in a longer prompt a word like "ok" or "delete" is incidental.
const CHORE_MAX_WORDS = 20

/** The app puts its own <system-reminder> blocks into some prompts (a session's first); route on what was typed. */
export function typedText(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

/**
 * Keyword rules, in order: Fable by name, web, follow-ups (same model as the last pick), clear chores,
 * real work, weak chore hints, acknowledgements, then very short prompts. Chore rules only count in short prompts.
 * Null when no rule fires.
 */
export function routeByRules(text: string, prev?: Tier): { tier: Tier; why: string } | null {
  const words = text.trim().split(/\s+/).length
  const short = words <= CHORE_MAX_WORDS
  if (FABLE.test(text)) return { tier: 'fable', why: 'asked for Fable' }
  for (const [re, why] of WEB) if (re.test(text)) return { tier: 'opus', why }
  if (words <= 6 && FOLLOW_UP.test(text)) return { tier: prev ?? 'opus', why: 'follow-up, same model as before' }
  if (short) for (const [re, why] of CHORE) if (re.test(text)) return { tier: 'sonnet', why }
  for (const [re, why] of OPUS) if (re.test(text)) return { tier: 'opus', why }
  if (short) for (const [re, why] of WEAK_CHORE) if (re.test(text)) return { tier: 'sonnet', why }
  if (short && ACK.test(text)) return prev && words >= 4 ? { tier: prev, why: 'follow-up, same model as before' } : { tier: 'sonnet', why: 'quick question' }
  // Very short prompts with nothing else to go on: part of the current task if there is one, else usually a chore.
  if (words <= 4) return prev ? { tier: prev, why: 'short follow-up' } : { tier: 'sonnet', why: 'short prompt' }
  return null
}

export const CLASSIFY_LABELS = ['quick chore', 'real task'] as const
export const CLASSIFY_PROMPT =
  'A student is asking an AI assistant for help. Is this a quick chore (one small action like adding a reminder, ' +
  'a calendar event, a short factual answer) or a real task (research, web browsing, homework, coding, writing, ' +
  'building documents, multi-step work)? Request:\n\n'
