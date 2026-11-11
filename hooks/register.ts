import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mode, Pick, Seen } from '../types'
import { CLASSIFY_LABELS, CLASSIFY_PROMPT, keepWarm, routeByRules, typedText } from './route'

const pick = atom({ plugin: 'model-router', key: 'pick' } as const, null)
const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto')
const served = atom({ plugin: 'model-router', key: 'served' } as const, null)
const seen = atom({ plugin: 'model-router', key: 'seen' } as const, {} as Seen)

const MODELS = ['auto', 'opus', 'sonnet', 'fable'] as const

// The API rejects bare aliases at this point, so switch with full model ids.
const IDS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', fable: 'claude-fable-5-2' } as const

// A chore takes a request or three (load a tool, call it, answer); the fifth means it isn't one.
const ESCALATE_AT_STEP = 4

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
    let chosen: Pick
    if (m !== 'auto') {
      chosen = { tier: m, why: 'locked with /route' }
    } else {
      const text = typedText(e.text)
      const byRule = routeByRules(text, (await read($, pick))?.tier)
      if (byRule) {
        chosen = byRule
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
      // A cheaper model that would have to re-read a big chat costs more than the warm one.
      const kept = keepWarm(chosen.tier, await read($, seen), await $.clock.now())
      if (kept !== chosen.tier) chosen = { tier: kept, why: `staying on ${kept}, its cache is warm (else ${chosen.tier}: ${chosen.why})` }
    }

    await update($, pick, () => chosen)
    $.ui.status(`${chosen.tier} · ${chosen.why}`)

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
    const r = !p || e.model.toLowerCase().includes(p.tier)
      ? yield* next(e)
      : yield* next({ ...e, model: IDS[p.tier] })
    const u = e.agentId === undefined ? r.usage : null
    if (u) {
      await update($, served, () => u.model)
      // Remember how much of the chat this model has now read, for keepWarm.
      const tier = (['opus', 'sonnet', 'fable'] as const).find(t => u.model.toLowerCase().includes(t))
      if (tier) {
        const at = await $.clock.now()
        const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        await update($, seen, s => ({ ...s, [tier]: { tokens, at } }))
      }
    }
    return r
  })
}
