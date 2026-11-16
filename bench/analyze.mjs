// Prints the tables from results.json. Run: node bench/analyze.mjs
import { readFileSync } from 'node:fs'
const R = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'))
const $ = n => '$' + (n ?? 0).toFixed(4)
const pct = (a, b) => (b ? (a > b ? '+' : '') + ((a / b - 1) * 100).toFixed(0) + '%' : 'n/a') // signed change vs baseline
const tok = u => (u ? u.in + u.cache_write + u.cache_read + u.out : 0)

console.log('== A. ROUTING ACCURACY ==')
const ok = R.routing.filter(r => r.tier === r.want)
console.log(`overall ${ok.length}/${R.routing.length} (${(100 * ok.length / R.routing.length).toFixed(0)}%)`)
for (const w of ['sonnet', 'opus', 'fable']) {
  const all = R.routing.filter(r => r.want === w)
  console.log(`  expected ${w}: ${all.filter(r => r.tier === w).length}/${all.length}`)
}
const viaC = R.routing.filter(r => r.via === 'classifier')
console.log(`  decided by rules: ${R.routing.length - viaC.length}, by classifier: ${viaC.length} (classifier right ${viaC.filter(r => r.tier === r.want).length}/${viaC.length}, cost ${$(viaC.reduce((s, r) => s + (r.cost ?? 0), 0))} total)`)
console.log('  misses:')
for (const r of R.routing.filter(r => r.tier !== r.want))
  console.log(`   want ${r.want.padEnd(6)} got ${r.tier.padEnd(6)} [${r.via}: ${r.why}]${r.prev ? ' (prev ' + r.prev + ')' : ''}  "${r.text.slice(0, 70)}"`)

console.log('\n== B. SAME TASKS ON EACH MODEL ==')
console.log('task pick    | cost sonnet / opus / fable      | out tokens s/o/f     | turns s/o/f | secs s/o/f   | pass s/o/f')
const T = { router: 0, sonnet: 0, opus: 0, fable: 0 }, TK = { router: 0, sonnet: 0, opus: 0, fable: 0 }, OUT = { router: 0, sonnet: 0, opus: 0, fable: 0 }
const G = { c: { router: 0, sonnet: 0, opus: 0, fable: 0 }, r: { router: 0, sonnet: 0, opus: 0, fable: 0 } }
for (const t of R.tasks) {
  const m = ['sonnet', 'opus', 'fable'].map(k => t.runs[k])
  console.log(`${t.id}   ${t.routed.tier.padEnd(7)} | ${m.map(x => $(x.cost)).join(' / ')} | ${m.map(x => String(x.usage?.out ?? '-').padStart(5)).join(' / ')} | ${m.map(x => x.turns ?? '-').join(' / ').padEnd(11)} | ${m.map(x => ((x.wall_ms ?? 0) / 1000).toFixed(0)).join(' / ').padEnd(12)} | ${m.map(x => (x.error ? 'ERR' : x.pass ? 'ok' : 'FAIL')).join(' / ')}`)
  for (const k of ['sonnet', 'opus', 'fable']) { T[k] += t.runs[k].cost ?? 0; TK[k] += tok(t.runs[k].usage); OUT[k] += t.runs[k].usage?.out ?? 0; G[t.id[0]][k] += t.runs[k].cost ?? 0 }
  const p = t.runs[t.routed.tier]
  T.router += (p.cost ?? 0) + (t.routed.cost ?? 0); TK.router += tok(p.usage); OUT.router += p.usage?.out ?? 0; G[t.id[0]].router += p.cost ?? 0
}
for (const k of ['router', 'sonnet', 'opus', 'fable'])
  console.log(`${(k === 'router' ? 'ROUTER' : 'always ' + k).padEnd(14)} cost ${$(T[k])}  total tokens ${TK[k]}  output tokens ${OUT[k]}  | chores ${$(G.c[k])}  real work ${$(G.r[k])}`)
console.log(`router vs always-opus:  cost ${pct(T.router, T.opus)}, tokens ${pct(TK.router, TK.opus)}   (chores only: ${pct(G.c.router, G.c.opus)})`)
console.log(`router vs always-fable: cost ${pct(T.router, T.fable)}, tokens ${pct(TK.router, TK.fable)}   (chores only: ${pct(G.c.router, G.c.fable)})`)
const esc = R.tasks.filter(t => t.routed.tier === 'sonnet' && (t.runs.sonnet.turns ?? 0) > 4).map(t => t.id)
console.log(`sonnet picks that would hit the step-4 escalation to opus: ${esc.length ? esc.join(', ') : 'none'}`)
for (const t of R.tasks) for (const k of ['sonnet', 'opus', 'fable']) if (t.runs[k].error) console.log('  ERROR', t.id, k, t.runs[k].error)

console.log('\n== C. MID-CHAT SWITCH (same chore as the 2nd turn) ==')
for (const c of R.cache) {
  console.log(`${c.name}: first turn on ${c.warm}, context ${tok(c.first.usage)} tokens over ${c.first.turns} requests, cost ${$(c.first.cost)}${c.first.error ? ' ERROR ' + c.first.error : ''}`)
  for (const [k, r] of Object.entries(c.next))
    console.log(`   2nd turn on ${k.padEnd(6)} cost ${$(r.cost)}  cache_read ${r.usage?.cache_read}  cache_write ${r.usage?.cache_write}  in ${r.usage?.in}  out ${r.usage?.out}${r.error ? ' ERROR ' + r.error : ''}`)
}
