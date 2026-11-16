// End-to-end check of the router in the real engine: several prompts through ONE headless Claude process, so the
// plugin's state lives across turns as it does in the app. It loads a temporary copy of this plugin with
// COMPACT_ABOVE_TOKENS lowered to 10k (so a small chat reaches the compaction path) and a probe plugin that logs
// every model request and compaction beneath the router.
//
// usage:   node bench/e2e/e2e.mjs <session model id> "<prompt 1>" "<prompt 2>" ...
// example: node bench/e2e/e2e.mjs claude-sonnet-5-5 "fix the typo in notes.txt" "how many days until december 12?" "thanks!" "and how many until new year's day?"
//
// Needs the claude CLI signed in and costs real usage. The repo path must not contain spaces.
// A prompt is sent after each result; the process closes once all are sent and no result has come for 20s
// (the router adds a turn of its own when it compacts).
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')
const [model, ...prompts] = process.argv.slice(2)
if (!model || !prompts.length) { console.error('usage: node bench/e2e/e2e.mjs <session model id> "<prompt>" ...'); process.exit(1) }

const work = path.join(ROOT, 'bench/runs', `e2e-${Date.now()}`)
const plugin = path.join(work, 'plugin'), chat = path.join(work, 'chat')
mkdirSync(chat, { recursive: true })
// The copy leaves the unit tests behind: with the lowered threshold they would fail, and `claude plugin test .` finds every *.test.ts under the repo.
for (const f of ['.claude-plugin/plugin.json', 'hooks', 'types', 'tsconfig.json']) cpSync(path.join(ROOT, f), path.join(plugin, f), { recursive: true, filter: s => !s.endsWith('.test.ts') })
const route = path.join(plugin, 'hooks/route.ts')
writeFileSync(route, readFileSync(route, 'utf8').replace(/COMPACT_ABOVE_TOKENS = [\d_]+/, 'COMPACT_ABOVE_TOKENS = 10_000'))
// About 9k tokens to read, with one typo to fix.
writeFileSync(path.join(chat, 'notes.txt'), Array.from({ length: 700 }, (_, i) => (i === 350 ? 'Signals homwork 6 is due friday' : 'signal filter voltage lab report ' + i)).join('\n'))

const fwd = p => p.replace(/\\/g, '/')
const p = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', model,
  '--setting-sources', 'project', '--strict-mcp-config', '--tools', 'Read,Edit', '--permission-mode', 'acceptEdits',
  '--plugin-dir', fwd(plugin), '--plugin-dir', fwd(path.join(HERE, 'probe'))], { cwd: chat, shell: true })
const send = t => p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: t } }) + '\n')
let buf = '', sent = 1, n = 0, idle
const kill = setTimeout(() => { console.log('TIMEOUT'); p.kill() }, 280_000)
p.stdout.on('data', d => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'system' && /compact/.test(j.subtype ?? '')) console.log(`   [${j.subtype}] ${JSON.stringify(j.compact_metadata ?? {}).slice(0, 110)}`)
    if (j.type === 'result') {
      console.log(`RESULT ${++n}: "${String(j.result).replace(/\s+/g, ' ').slice(0, 80)}" turns=${j.num_turns}`)
      if (sent < prompts.length) send(prompts[sent++])
      clearTimeout(idle)
      if (sent >= prompts.length) idle = setTimeout(() => { clearTimeout(kill); p.stdin.end() }, 20_000)
    }
  }
})
p.stderr.on('data', () => {})
p.on('close', () => {
  console.log('\n--- probe log (what reached the model, beneath the router)')
  try { console.log(readFileSync(path.join(chat, 'probe.log'), 'utf8')) } catch { console.log('(no probe log: the plugins did not load)') }
})
send(prompts[0])
