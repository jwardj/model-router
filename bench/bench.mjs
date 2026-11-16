// Model-router benchmark: routing accuracy + same tasks on each model + cache-switch test.
// Run: node bench/bench.mjs   (writes bench/results.json; needs the claude CLI signed in; costs real usage)
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTE = path.join(HERE, '../hooks/route.ts')
const { routeByRules, CLASSIFY_PROMPT } = await import(pathToFileURL(ROUTE).href)

const IDS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-2', haiku: 'claude-haiku-5-5' }
const BASE = ['-p', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config',
  '--tools', 'Read,Write,Edit,Glob,Grep', '--permission-mode', 'acceptEdits']

// ---- tiny concurrency pool -------------------------------------------------
let active = 0; const queue = []
const pool = fn => new Promise(res => { queue.push([fn, res]); pump() })
function pump() {
  while (active < 8 && queue.length) {
    const [fn, res] = queue.shift(); active++
    fn().then(r => { active--; res(r); pump() })
  }
}
const claude = (tier, prompt, cwd, extra = []) => pool(() => new Promise(res => {
  mkdirSync(cwd, { recursive: true })
  const t0 = Date.now()
  const p = spawn('claude', [...BASE, '--model', IDS[tier], ...extra], { cwd, shell: true })
  let out = '', err = ''
  const kill = setTimeout(() => p.kill(), 300_000)
  p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d))
  p.on('close', code => {
    clearTimeout(kill)
    try { res({ ...JSON.parse(out), wall_ms: Date.now() - t0 }) } catch { res({ error: (err || out).slice(0, 500), code }) }
  })
  p.stdin.end(prompt)
}))
const slim = r => r.error ? r : {
  cost: r.total_cost_usd, turns: r.num_turns, wall_ms: r.wall_ms, api_ms: r.duration_api_ms, is_error: r.is_error,
  usage: r.usage && { in: r.usage.input_tokens, cache_write: r.usage.cache_creation_input_tokens, cache_read: r.usage.cache_read_input_tokens, out: r.usage.output_tokens },
  modelUsage: r.modelUsage, session_id: r.session_id, result: r.result,
}

// ---- A. routing accuracy ---------------------------------------------------
// [prompt, expected tier, previous pick (for follow-ups)]
const LABELLED = [
  ['add a reminder to the dashboard to submit my timesheet friday', 'sonnet'],
  ['remind me to call the dentist tomorrow at 3', 'sonnet'],
  ['add office hours to my calendar thursday 2pm', 'sonnet'],
  ['put a reminder on the dashboard for after classes to pick up my package', 'sonnet'],
  ['move my gym session from tuesday to wednesday', 'sonnet'],
  ['reschedule my advisor meeting to next monday', 'sonnet'],
  ['when is my next class', 'sonnet'],
  ["what's due this week", 'sonnet'],
  ['how many days until thanksgiving', 'sonnet'],
  ['thanks!', 'sonnet'],
  ['rename the lab folder to lab5', 'sonnet'],
  ['mark the physics quiz as done', 'sonnet'],
  ['delete the old reminder about the dentist', 'sonnet'],
  ['fix the typo in my reminder title', 'sonnet'],
  ['send it to me', 'sonnet'],
  ["what's the weather today", 'sonnet'],
  ['add milk to my shopping list', 'sonnet'],
  ['what time does the library close tonight', 'sonnet'],
  ['set a reminder for my laundry in 40 minutes', 'sonnet'],
  ['cross off laundry from my list', 'sonnet'],
  ['play some lofi music for studying please', 'sonnet'],
  ['add a reminder for my ECE306 lab report due friday', 'sonnet'],
  ['mark the ECE306 quiz as done', 'sonnet'],
  ['is my 2pm class cancelled today or not', 'sonnet'],
  ['schedule a study session for saturday morning', 'sonnet'],
  ['can you add a calendar event for the career fair on the 20th', 'sonnet'],
  ["what's on my calendar tomorrow", 'sonnet'],
  ['ok cool', 'sonnet', 'opus'],
  ['the tortoise and the hare is my favorite fable, thanks', 'sonnet'],
  ['also add a reminder to turn it in', 'sonnet', 'opus'],
  ['sure, go ahead and add it to my calendar', 'sonnet', 'opus'],

  ['make the ipad worksheet for ECE306 hw 5', 'opus'],
  ["explain why my fourier series doesn't converge at the jump", 'opus'],
  ['write a python script to scrape my grades into a csv', 'opus'],
  ['debug why my matlab loop is off by one', 'opus'],
  ['write me a cover letter for the GE Aerospace co-op', 'opus'],
  ['research the best microcontrollers for a line-following robot and compare them', 'opus'],
  ['build a new feature for the dashboard that charts my sleep', 'opus'],
  ['help me study for my signals midterm', 'opus'],
  ['summarize this 30 page reading on semiconductor physics', 'opus'],
  ['plan my whole spring semester schedule around these prerequisites', 'opus'],
  ['look up when the career fair is and add a reminder', 'opus'],
  ['find me three co-op openings and draft emails to each', 'opus'],
  ['can you check my lab report for mistakes', 'opus'],
  ['convert my resume to a one page pdf', 'opus'],
  ['why is my circuit oscillating', 'opus'],
  ['make a study guide for chapter 7', 'opus'],
  ['I have a thermodynamics exam tomorrow, walk me through the rankine cycle', 'opus'],
  ['refactor the tray app so uploads retry on failure', 'opus'],
  ['set up a github action that runs my tests', 'opus'],
  ['grade my essay against this rubric', 'opus'],
  ["figure out why the dashboard isn't loading reminders", 'opus'],
  ['add a dark mode to the dashboard', 'opus'],
  ['remind me how convolution works', 'opus'],
  ['is this code ok', 'opus'],
  ['delete all the duplicate rows in this spreadsheet and summarize what changed', 'opus'],
  ['write a fable for my english class', 'opus'],
  ['proofread my personal statement', 'opus'],
  ['go online and find the cheapest flight to denver for spring break', 'opus'],
  ['design a pcb layout checklist for my senior project', 'opus'],
  ['ok so I was looking at my notes and I think the reminder system we talked about should probably be rebuilt so that it reads from the calendar directly instead of the json file, can you plan that out', 'opus'],
  ['continue', 'opus', 'opus'],
  ['fix the second one', 'opus', 'opus'],
  ['no, make it shorter', 'opus', 'opus'],
  ["that's wrong, redo problem 3 with the right units", 'opus', 'opus'],
  ['yes', 'opus'],
  ['thanks, now do the same for chapter 8', 'opus', 'opus'],
  ['ok now make it handle negative numbers too', 'opus', 'opus'],
  ['yes do it', 'sonnet', 'sonnet'],

  ['use fable to explain this circuit', 'fable'],
  ['fable: add a reminder for friday', 'fable'],
  ['switch to Fable 5.2', 'fable'],
  ['can fable handle this one? make my worksheet', 'fable'],
  ['have Fable do this', 'fable'],
  ['ask fable to review my essay', 'fable'],
  ['i want fable for this one', 'fable'],
  ['keep going', 'fable', 'fable'],
  ['i want you to run test on the model router and to test how good it is a saving tokens. use fable to do this', 'fable'],
]

const classify = async text => {
  const r = await claude('haiku', CLASSIFY_PROMPT + text + '\n\nAnswer with exactly one label and nothing else: quick chore OR real task', path.join(HERE, 'runs/_classify'), ['--max-turns', '1'])
  return { tier: /chore/i.test(r.result ?? '') ? 'sonnet' : 'opus', why: r.error ? 'classifier failed, defaulting up' : 'classifier (simulated with Haiku)', cost: r.total_cost_usd ?? 0 }
}
const pick = async (text, prev) => {
  const rule = routeByRules(text, prev)
  return rule ? { ...rule, via: 'rule' } : { ...(await classify(text)), via: 'classifier' }
}
const routingP = Promise.all(LABELLED.map(async ([text, want, prev]) => ({ text, want, prev, ...(await pick(text, prev)) })))

// ---- B. same tasks on every model -----------------------------------------
const SEED = {
  'reminders.md': '# Reminders\n- [ ] Buy graph paper\n- [ ] Return library book\n',
  'notes.md': '# Lab 3 notes\n\nMeasured gain was 9.7 with a 1k load.\n',
  'todo.md': '# Todo\n- [ ] Physics quiz (thursday)\n- [ ] Signals homwork 6 (friday)\n- [x] Laundry\n',
  'buggy.py': 'def median(xs):\n    xs.sort()\n    n = len(xs)\n    if n % 2 == 0:\n        return xs[n // 2]\n    return xs[n // 2]\n\nif __name__ == "__main__":\n    print(median([3, 1, 4, 2]))\n',
  'grades.csv': 'name,hw,midterm,final\nAna,90,80,70\nBen,60,75,95\n',
}
const file = (d, f) => existsSync(path.join(d, f)) ? readFileSync(path.join(d, f), 'utf8') : ''
const py = (d, ...a) => spawnSync('python', a, { cwd: d, encoding: 'utf8', timeout: 20_000 })
const TASKS = [
  ['c1', 'add a reminder to my list in reminders.md to email Prof Chen about the lab report friday', (d) => /chen/i.test(file(d, 'reminders.md'))],
  ['c2', 'rename the heading in notes.md from Lab 3 to Lab 4', (d) => /Lab 4/.test(file(d, 'notes.md')) && !/Lab 3/.test(file(d, 'notes.md'))],
  ['c3', 'how many days until december 12?', (d, r) => /\b26\b/.test(r)],
  ['c4', 'fix the typo in todo.md', (d) => /homework/.test(file(d, 'todo.md'))],
  ['c5', 'mark the physics quiz as done in todo.md', (d) => /\[x\] Physics quiz/i.test(file(d, 'todo.md'))],
  ['r1', "write a python script grades.py that reads grades.csv and prints each student's weighted average (hw 30%, midterm 30%, final 40%)", (d) => { const o = py(d, 'grades.py').stdout ?? ''; return /79/.test(o) && /78\.5/.test(o) }],
  ['r2', 'explain why the fourier transform of a rectangular pulse is a sinc function, with the derivation', (d, r) => /sinc/i.test(r) && r.length > 300],
  ['r3', 'write me a 300 word essay on why engineers should study ethics', (d, r) => { const w = r.split(/\s+/).length; return w > 200 && w < 420 }],
  ['r4', 'debug my script buggy.py, the median is wrong for even-length lists', (d) => /2\.5/.test(py(d, 'buggy.py').stdout ?? '')],
  ['r5', 'solve: a 10 ohm resistor in series with a 5 mH inductor at 1 kHz. find the impedance magnitude and phase angle', (d, r) => /3[23]\.[09]/.test(r) && /72\.[234]/.test(r)],
  ['r6', 'compare merge sort and quicksort on nearly sorted arrays and build a small benchmark in sort_bench.py', (d) => existsSync(path.join(d, 'sort_bench.py')) && py(d, '-m', 'py_compile', 'sort_bench.py').status === 0],
]
const tasksP = Promise.all(TASKS.map(async ([id, prompt, check]) => {
  const routed = await pick(prompt)
  const runs = Object.fromEntries(await Promise.all(['sonnet', 'opus', 'fable'].map(async tier => {
    const d = path.join(HERE, 'runs', `${id}-${tier}`)
    mkdirSync(d, { recursive: true })
    for (const [f, c] of Object.entries(SEED)) writeFileSync(path.join(d, f), c)
    const r = slim(await claude(tier, prompt, d))
    let pass = false
    try { pass = !r.error && !!check(d, r.result ?? '') } catch {}
    return [tier, { ...r, pass, result: (r.result ?? '').slice(0, 1500) }]
  })))
  return { id, prompt, routed, runs }
}))

// ---- C. is a mid-chat switch to a cheaper model worth it? ------------------
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const WORDS = 'signal circuit filter voltage current resistor capacitor inductor fourier laplace sample noise gain phase lab report friday measure plot the a of and with from into about because therefore'.split(' ')
const blob = n => Array.from({ length: n }, (_, i) => WORDS[Math.floor(rnd() * WORDS.length)] + (i % 14 === 13 ? '.\n' : '')).join(' ')
const CHORE = 'how many days until december 12?'
const cacheTest = async (name, warm, big, forks) => {
  const d = path.join(HERE, 'runs', `cache-${name}`)
  mkdirSync(d, { recursive: true })
  if (big) { writeFileSync(path.join(d, 'notes1.txt'), blob(8000)); writeFileSync(path.join(d, 'notes2.txt'), blob(8000)) }
  const first = slim(await claude(warm, big ? 'Read notes1.txt and notes2.txt fully, then reply with only the word: ready' : 'reply with only the word: ready', d))
  const next = first.session_id ? Object.fromEntries(await Promise.all(forks.map(async t =>
    [t, slim(await claude(t, CHORE, d, ['--resume', first.session_id, '--fork-session']))]))) : {}
  return { name, warm, big, first, next }
}
const cacheP = Promise.all([
  cacheTest('big-opus', 'opus', true, ['opus', 'sonnet']),
  cacheTest('small-opus', 'opus', false, ['opus', 'sonnet']),
  cacheTest('big-fable', 'fable', true, ['fable', 'opus', 'sonnet']),
])

const out = { when: new Date().toISOString(), routing: await routingP, tasks: await tasksP, cache: await cacheP }
writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(out, (k, v) => (k === 'session_id' ? undefined : v), 1))
console.log('done')
