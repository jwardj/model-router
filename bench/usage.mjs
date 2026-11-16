// Where your own Claude Code usage went, read from the session transcripts on this machine: by model, by token
// type (cache reads, cache writes, output), by the router's reason for each pick, and what cold re-reads cost.
// Costs are list-price estimates: per-token rates are fitted to the CLI's own cost figures in results.json.
// Run: node bench/usage.mjs [since]   (since: an ISO date in UTC such as 2026-11-10T20:11:00Z; default 7 days ago)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SINCE = new Date(process.argv[2] ?? Date.now() - 7 * 864e5).getTime()
const tierOf = m => ['opus', 'sonnet', 'fable', 'haiku'].find(t => m.includes(t))

// ---- fit rates ($ per token) for cache write, cache read, output, per model ----
const R = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'))
const rows = {}
const add = mu => { for (const [m, u] of Object.entries(mu ?? {})) (rows[tierOf(m)] ??= []).push([[u.cacheCreationInputTokens, u.cacheReadInputTokens, u.outputTokens], u.costUSD]) }
for (const t of R.tasks) for (const r of Object.values(t.runs)) add(r.modelUsage)
for (const c of R.cache) { add(c.first.modelUsage); for (const r of Object.values(c.next)) add(r.modelUsage) }
const solve = (A, b) => { // gaussian elimination, 3x3
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k
    ;[M[i], M[p]] = [M[p], M[i]]
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j] }
  }
  const x = Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) x[i] = (M[i][n] - M[i].slice(i + 1, n).reduce((s, v, j) => s + v * x[i + 1 + j], 0)) / M[i][i]
  return x
}
const RATE = {}
for (const [t, rs] of Object.entries(rows)) {
  if (t === 'haiku' || rs.length < 3) continue
  const A = [0, 1, 2].map(i => [0, 1, 2].map(j => rs.reduce((s, [x]) => s + x[i] * x[j], 0)))
  const b = [0, 1, 2].map(i => rs.reduce((s, [x, y]) => s + x[i] * y, 0))
  const [w, r, o] = solve(A, b)
  RATE[t] = { w, r, o }
}
console.log('fitted list-price rates, $ per million tokens (cache write / cache read / output):')
for (const [t, x] of Object.entries(RATE)) console.log(`  ${t.padEnd(7)} ${(x.w * 1e6).toFixed(2)} / ${(x.r * 1e6).toFixed(2)} / ${(x.o * 1e6).toFixed(2)}`)
const cost = (t, u) => RATE[t] ? u.cw * RATE[t].w + (u.cr + u.in) * RATE[t].r + u.out * RATE[t].o : 0
const $ = n => '$' + n.toFixed(2)

// ---- walk transcripts ----
const root = path.join(os.homedir(), '.claude/projects')
const files = []
const walk = d => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : p.endsWith('.jsonl') && statSync(p).mtimeMs >= SINCE && files.push(p) } }
// The benchmark's own headless runs (bench/runs/...) are not real use.
for (const d of readdirSync(root)) if (!/-bench-runs-/.test(d)) walk(path.join(root, d))

const main = {}, side = {}, why = {}, cold = {}, noNote = {}
let sessions = 0, prompts = 0, reqs = 0, escal = 0, stickyAsOpus = 0, stickyCost = 0, ctxSum = 0
const firstCtx = []
for (const f of files) {
  const sub = /subagents/.test(f)
  const seen = new Map(); let reason = null, n = 0
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    const ts = new Date(j.timestamp).getTime()
    if (ts < SINCE) continue
    const note = j.type === 'attachment' && j.attachment?.type === 'hook_additional_context' && String(j.attachment.content?.[0] ?? '')
    const m = note && note.match(/routed to (claude-[\w-]+) \((.+?)\)\.(?: The previous| If asked)/)
    if (m) { reason = { tier: tierOf(m[1]), why: m[2], models: [] }; prompts++; continue }
    if (j.type !== 'assistant' || !j.message?.usage || !j.message.model || j.message.model.startsWith('<')) continue
    const u0 = j.message.usage
    seen.set(j.message.id, { t: tierOf(j.message.model), ts, reason, ep: j.entrypoint, f: path.basename(path.dirname(f)).slice(-22) + '/' + path.basename(f).slice(0, 8), side: sub || j.isSidechain,
      u: { in: u0.input_tokens || 0, cw: u0.cache_creation_input_tokens || 0, cr: u0.cache_read_input_tokens || 0, out: u0.output_tokens || 0 } })
  }
  if (!seen.size) continue
  if (!sub) sessions++
  let prev = null
  for (const x of seen.values()) {
    if (!x.t) continue
    const c = cost(x.t, x.u), ctx = x.u.in + x.u.cw + x.u.cr
    const bucket = x.side ? side : main
    const b = (bucket[x.t] ??= { req: 0, cw: 0, cr: 0, out: 0, cost: 0, cwCost: 0, crCost: 0, outCost: 0 })
    b.req++; b.cw += x.u.cw; b.cr += x.u.cr + x.u.in; b.out += x.u.out; b.cost += c
    if (RATE[x.t]) { b.cwCost += x.u.cw * RATE[x.t].w; b.crCost += (x.u.cr + x.u.in) * RATE[x.t].r; b.outCost += x.u.out * RATE[x.t].o }
    if (x.side) continue
    reqs++; ctxSum += ctx; if (n++ === 0) firstCtx.push(ctx)
    // which rule put this request on its model
    const r = x.reason
    if (!r) { const q = (noNote[x.f + ' ' + x.ep + ' ' + x.t] ??= { req: 0, cost: 0, from: x.ts, to: x.ts }); q.req++; q.cost += c; q.to = x.ts }
    const key = !r ? 'no router note' : /^staying on/.test(r.why) ? `kept on warm ${r.tier} (pick was ${r.why.match(/else (\w+)/)?.[1]})` : `${x.t}: ${r.why.replace(/after \d+ steps/, 'after N steps')}`
    const k = (why[key] ??= { req: 0, cost: 0 }); k.req++; k.cost += c
    if (r && /^staying on fable/.test(r.why)) { stickyCost += c; stickyAsOpus += cost('opus', x.u) }
    if (r) { if (r.models.at(-1) === 'sonnet' && x.t === 'opus') escal++; r.models.push(x.t) }
    // cold re-reads: most of the context written to the cache again
    if (x.u.cw > 20_000 && x.u.cw > 0.5 * ctx) {
      const gap = prev ? (x.ts - prev.ts) / 60_000 : null
      const cause = !prev ? 'first request of a chat' : prev.t !== x.t ? `model switch ${prev.t} -> ${x.t}${gap > 60 ? ', after 1h+ idle' : ', cache was warm'}` : gap > 60 ? 'idle over 1 hour, on ' + x.t : gap > 5 ? 'idle 5-60 min' : 'other (compaction, new files)'
      const q = (cold[cause] ??= { n: 0, tokens: 0, cost: 0 }); q.n++; q.tokens += x.u.cw; q.cost += RATE[x.t] ? x.u.cw * RATE[x.t].w : 0
    }
    prev = x
  }
}
const total = Object.values(main).reduce((s, b) => s + b.cost, 0), sideTotal = Object.values(side).reduce((s, b) => s + b.cost, 0)
console.log(`\n${sessions} chats, ${prompts} routed prompts, ${reqs} main requests (${(reqs / Math.max(prompts, 1)).toFixed(1)} per prompt)`)
console.log(`context per request: average ${Math.round(ctxSum / reqs / 1000)}k tokens; a chat's first request (fixed prompt): median ${Math.round(firstCtx.sort((a, b) => a - b)[firstCtx.length >> 1] / 1000)}k`)
console.log(`\nMAIN THREAD, est. ${$(total)}`)
for (const [t, b] of Object.entries(main)) console.log(`  ${t.padEnd(7)} ${String(b.req).padStart(4)} req  ${$(b.cost).padStart(8)}  = cache reads ${$(b.crCost)} + cache writes ${$(b.cwCost)} + output ${$(b.outCost)}`)
const sum = k => Object.values(main).reduce((s, b) => s + b[k], 0)
console.log(`  share: cache reads ${(100 * sum('crCost') / total).toFixed(0)}%, cache writes ${(100 * sum('cwCost') / total).toFixed(0)}%, output ${(100 * sum('outCost') / total).toFixed(0)}%`)
console.log(`\nSUBAGENTS, est. ${$(sideTotal)}`)
for (const [t, b] of Object.entries(side)) console.log(`  ${t.padEnd(7)} ${String(b.req).padStart(4)} req  ${$(b.cost).padStart(8)}`)
console.log('\nBY ROUTER REASON (main thread)')
for (const [k, v] of Object.entries(why).sort((a, b) => b[1].cost - a[1].cost)) console.log(`  ${$(v.cost).padStart(8)}  ${String(v.req).padStart(4)} req  ${k}`)
console.log(`\nrequests kept on warm Fable: ${$(stickyCost)} as run; the same tokens at Opus rates ${$(stickyAsOpus)} (ignores the one-time switch re-read)`)
console.log(`sonnet -> opus escalations inside one prompt: ${escal}`)
console.log('\nCOLD RE-READS (most of the chat written to the cache again)')
for (const [k, v] of Object.entries(cold).sort((a, b) => b[1].cost - a[1].cost)) console.log(`  ${$(v.cost).padStart(8)}  ${String(v.n).padStart(3)}x  ${Math.round(v.tokens / 1000)}k tokens  ${k}`)

console.log('\nREQUESTS WITH NO ROUTER NOTE')
for (const [k, v] of Object.entries(noNote).sort((a, b) => b[1].cost - a[1].cost)) console.log(`  ${$(v.cost).padStart(8)}  ${String(v.req).padStart(3)} req  ${k}  ${new Date(v.from).toISOString().slice(5, 16)} to ${new Date(v.to).toISOString().slice(5, 16)}`)
