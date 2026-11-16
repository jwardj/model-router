// Same tasks on Opus at medium, high and xhigh effort: output tokens, cost, time, and whether the answer was right.
// Run: node bench/effort.mjs   (needs the claude CLI signed in; costs real usage)
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUGGY = 'def median(xs):\n    xs.sort()\n    n = len(xs)\n    if n % 2 == 0:\n        return xs[n // 2]\n    return xs[n // 2]\n\nif __name__ == "__main__":\n    print(median([3, 1, 4, 2]))\n'
const TASKS = [
  ['circuit', 'solve: a 10 ohm resistor in series with a 5 mH inductor at 1 kHz. find the impedance magnitude and phase angle', (d, r) => /3[23]\.[09]/.test(r) && /72\.[234]/.test(r)],
  ['signals', 'a signal x(t) = 3cos(200*pi*t) + 2sin(600*pi*t) is sampled at 500 Hz. which frequencies appear in the sampled signal between 0 and 250 Hz, and is there aliasing? show the reasoning', (d, r) => /\b100\b/.test(r) && /\b200\b/.test(r) && /alias/i.test(r)],
  ['debug', 'debug my script buggy.py, the median is wrong for even-length lists', d => /2\.5/.test(spawnSync('python', ['buggy.py'], { cwd: d, encoding: 'utf8' }).stdout ?? '')],
  ['essay', 'write me a 300 word essay on why engineers should study ethics', (d, r) => { const w = r.split(/\s+/).length; return w > 200 && w < 420 }],
]
const run = (id, prompt, check, effort) => new Promise(res => {
  const d = path.join(HERE, 'runs', `effort-${id}-${effort}`)
  mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, 'buggy.py'), BUGGY)
  const t0 = Date.now()
  const p = spawn('claude', ['-p', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config', '--tools', 'Read,Write,Edit,Glob,Grep',
    '--permission-mode', 'acceptEdits', '--model', 'claude-opus-5-5', '--effort', effort], { cwd: d, shell: true })
  let out = ''
  p.stdout.on('data', x => (out += x)); p.stderr.on('data', () => {})
  p.on('close', () => {
    try {
      const j = JSON.parse(out)
      let ok = false; try { ok = !!check(d, j.result ?? '') } catch {}
      res({ id, effort, out: j.usage.output_tokens, thinking: j.usage.output_tokens_details?.thinking_tokens, cost: j.total_cost_usd, secs: (Date.now() - t0) / 1000, turns: j.num_turns, ok })
    } catch { res({ id, effort, error: out.slice(0, 200) }) }
  })
  p.stdin.end(prompt)
})
const rows = await Promise.all(TASKS.flatMap(([id, prompt, check]) => ['medium', 'high', 'xhigh'].map(e => run(id, prompt, check, e))))
writeFileSync(path.join(HERE, 'effort-results.json'), JSON.stringify(rows, null, 1))
console.log('task     effort  output tok  thinking  cost     secs  right')
for (const r of rows) console.log(r.error ? `${r.id} ${r.effort} ERROR ${r.error}` : `${r.id.padEnd(8)} ${r.effort.padEnd(7)} ${String(r.out).padStart(9)}  ${String(r.thinking ?? '-').padStart(8)}  $${r.cost.toFixed(4)}  ${r.secs.toFixed(0).padStart(4)}  ${r.ok ? 'yes' : 'NO'}`)
for (const e of ['medium', 'high', 'xhigh']) {
  const g = rows.filter(r => r.effort === e && !r.error)
  console.log(`TOTAL ${e.padEnd(7)} output ${g.reduce((s, r) => s + r.out, 0)}  cost $${g.reduce((s, r) => s + r.cost, 0).toFixed(4)}  secs ${g.reduce((s, r) => s + r.secs, 0).toFixed(0)}  right ${g.filter(r => r.ok).length}/${g.length}`)
}
