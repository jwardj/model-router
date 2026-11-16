import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode, Pick, Seen } from '../types'
import {
  CLASSIFY_LABELS, CLASSIFY_PROMPT, NEW_TASK_LABELS,
  compactInstructions, inherited, keepWarm, lastSeen, newTaskPrompt, routeByRules, shouldCompact, typedText,
} from './route'

const pick = atom({ plugin: 'model-router', key: 'pick' } as const, null)
const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto')
const served = atom({ plugin: 'model-router', key: 'served' } as const, null)
const seen = atom({ plugin: 'model-router', key: 'seen' } as const, {} as Seen)
// The new task whose first reply is to be followed by a compaction of the old chat; null when none is due.
const compactAfter = atom({ plugin: 'model-router', key: 'compactAfter' } as const, null)
// True from asking for a compaction until a reply shows the chat came back smaller: until then `seen` still holds
// the old size, and going by it would compact the fresh summary a second time.
const compacting = atom({ plugin: 'model-router', key: 'compacting' } as const, false)

const TIERS = ['opus', 'sonnet', 'fable'] as const
const MODELS = ['auto', ...TIERS] as const

// The API rejects bare aliases at this point, so switch with full model ids.
const IDS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', fable: 'claude-fable-5-2' } as const

// A chore takes a request or three (load a tool, call it, answer); the fifth means it isn't one.
const ESCALATE_AT_STEP = 4

/** Whether this prompt starts a task unrelated to the request before it. Unsure means no: a compaction is not undone. */
async function startsNewTask($: EngineInterface, text: string): Promise<boolean> {
  try {
    const all = await $.session.messages()
    if (!Array.isArray(all)) return false
    const before = all.map(m => (m.role === 'user' ? typedText(m.text ?? '') : '')).filter(t => t && t !== text).at(-1)
    return !!before && (await $.model.classify(newTaskPrompt(before, text), NEW_TASK_LABELS)) === 'new task'
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router: /route auto | opus | sonnet | fable (no argument shows the current pick)',
    })
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if ((MODELS as readonly string[]).includes(arg)) {
      await update($, mode, () => arg as Mode)
      $.ui.status(arg === 'auto' ? undefined : `router: locked to ${arg}`)
      return { text: arg === 'auto' ? 'Router back on auto.' : `Router locked to ${arg} until you run /route auto.` }
    }
    const m = await read($, mode)
    const p = await read($, pick)
    const got = await read($, served)
    return { text: `Mode: ${m}. Last pick: ${p ? `${p.tier} (${p.why})` : 'none yet'}. Last reply answered by: ${got ?? 'unknown yet'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only the person's own prompts change the pick; notifications ride the current one.
    if (e.origin.kind !== 'composer' && e.turnId !== undefined) return next(e)

    const m = await read($, mode)
    const text = typedText(e.text)
    const now = await $.clock.now()
    const seenNow = await read($, seen)
    const prev = (await read($, pick))?.tier
    const byRule = routeByRules(text, inherited(prev, seenNow, now))
    let chosen: Pick
    if (m !== 'auto') {
      chosen = { tier: m, why: 'locked with /route' }
    } else {
      if (byRule) {
        // A follow-up only comes back as Opus after Fable when the cache had lapsed (see `inherited`).
        chosen = prev === 'fable' && byRule.tier === 'opus' && /follow-up/.test(byRule.why)
          ? { tier: 'opus', why: 'follow-up after an hour idle, Fable not kept' }
          : byRule
      } else {
        try {
          const label = await $.model.classify(CLASSIFY_PROMPT + text.slice(0, 4000), CLASSIFY_LABELS)
          chosen = label === 'quick chore'
            ? { tier: 'sonnet', why: 'judged a quick chore' }
            : { tier: 'opus', why: 'judged a real task' }
        } catch {
          chosen = { tier: 'opus', why: 'unsure, defaulting up' }
        }
      }
      // A chore needs little thought, whichever model ends up answering it. A follow-up that merely inherits
      // Sonnet is left at its usual effort: it may be more than the chore it follows.
      const low = chosen.tier === 'sonnet' && !/follow-up/.test(chosen.why)
      // A cheaper model that would have to re-read a big chat costs more than the warm one.
      const kept = keepWarm(chosen.tier, seenNow, now)
      if (kept !== chosen.tier) chosen = { tier: kept, why: `staying on ${kept}, its cache is warm (else ${chosen.tier}: ${chosen.why})` }
      if (low) chosen = { ...chosen, low: true }
    }

    // A new task in a big chat: compact once its first reply is in, so the rest of the task does not carry the old
    // chat on every request. Not here: the engine refuses a compaction from this hook, the turn is already held.
    const fresh =
      e.turnId === undefined && !/follow-up/.test(byRule?.why ?? '') && !(await read($, compacting)) &&
      shouldCompact(seenNow, await $.session.model(), chosen.tier) && (await startsNewTask($, text))
    await update($, compactAfter, () => (fresh ? text.replace(/\s+/g, ' ').slice(0, 300) : null))

    await update($, pick, () => chosen)
    $.ui.status(`${chosen.tier} · ${chosen.why}${fresh ? ', compacting the old chat after this reply' : ''}`)

    // Tell the model the truth about which model is answering; the session label never changes.
    const got = await read($, served)
    const note =
      `Model router: this reply is routed to ${IDS[chosen.tier]} (${chosen.why}).` +
      (got ? ` The previous reply was answered by ${got}.` : '') +
      ` If asked which model is answering, report this routed model, not the session label.`
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // Main thread only; subagents keep whatever model they were given.
    let p = e.agentId === undefined ? await read($, pick) : null
    // A "chore" still going after several model requests is real work: Opus for the rest of it and what follows.
    if (p?.tier === 'sonnet' && e.index >= ESCALATE_AT_STEP && (await read($, mode)) === 'auto') {
      const up: Pick = { tier: 'opus', why: `escalated after ${e.index} steps` }
      await update($, pick, () => up)
      $.ui.status(`opus · ${up.why}`)
      p = up
    }
    const model = !p || e.model.toLowerCase().includes(p.tier) ? e.model : IDS[p.tier]
    // These models take effort per message, so lowering it for a chore keeps the chat's cache (measured 2026-11-16).
    const low = !!p?.low && e.effort !== undefined && e.effort !== 'low'
    const r = yield* next(model === e.model && !low ? e : { ...e, model, ...(low && { effort: 'low' as const }) })
    const u = e.agentId === undefined ? r.usage : null
    if (u) {
      await update($, served, () => u.model)
      // Remember how much of the chat this model has now read, for keepWarm.
      const tier = TIERS.find(t => u.model.toLowerCase().includes(t))
      if (tier) {
        const at = await $.clock.now()
        const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        // The chat came back clearly smaller: a compaction has happened, so sizes can be trusted again.
        if (tokens < 0.8 * (lastSeen(await read($, seen))?.tokens ?? 0)) await update($, compacting, () => false)
        await update($, seen, s => ({ ...s, [tier]: { tokens, at } }))
      }
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const task = e.agentId === undefined && e.reason === 'answer' ? await read($, compactAfter) : null
    if (!task) return r
    await update($, compactAfter, () => null)
    // The engine compacts on the session's own model. Only when that model just answered is its cache of this chat
    // warm; on any other the summary re-reads the whole chat at full price (see `shouldCompact`).
    const got = (await read($, served))?.toLowerCase() ?? ''
    const own = (await $.session.model()).toLowerCase()
    if (!TIERS.some(t => got.includes(t) && own.includes(t))) return r
    await update($, compacting, () => true)
    try {
      await $.session.compact({ instructions: compactInstructions(task) })
    } catch {
      // The app's sessions cannot compact from a hook yet (measured 2026-11-16); there /compact does it, queued to
      // run once the session is idle. Not awaited: this hook is what the turn is waiting on.
      void $.command.run({ command: 'compact', args: compactInstructions(task) }).catch(() => {})
    }
    return r
  })
}
