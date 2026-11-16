// Re-scores the 78 labelled prompts in results.json against the router's current rules.
// Prompts that still fall through to the classifier reuse the classifier answer recorded in results.json.
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
const ROUTE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../hooks/route.ts')
const { routeByRules } = await import(pathToFileURL(ROUTE).href)
const old = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8')).routing
let ok = 0
for (const r of old) {
  const rule = routeByRules(r.text, r.prev)
  const now = rule ? rule.tier : r.via === 'classifier' ? r.tier : 'UNDECIDED (new fall-through, needs the classifier)'
  if (now === r.want) ok++
  if (now !== r.tier || now !== r.want) console.log(`${now === r.want ? 'FIXED ' : 'MISS  '} want ${r.want.padEnd(6)} was ${r.tier.padEnd(6)} now ${now}${rule ? ' [' + rule.why + ']' : ''}  "${r.text.slice(0, 60)}"`)
}
console.log(`\n${ok}/${old.length} correct (${(100 * ok / old.length).toFixed(0)}%), was ${old.filter(r => r.tier === r.want).length}/${old.length}`)
