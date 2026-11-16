import { expect, test } from 'claude-code/testing'
import { CACHE_TTL_MS, keepWarm, routeByRules, typedText } from './route'

test('a cheaper pick does not throw away a warm cache on a big chat', () => {
  const now = 10 * CACHE_TTL_MS
  const big = { tokens: 80_000, at: now - 60_000 }
  expect(keepWarm('sonnet', { opus: big }, now)).toBe('opus')
  expect(keepWarm('opus', { fable: big }, now)).toBe('fable')
  // Moves up are never held back.
  expect(keepWarm('opus', { sonnet: big }, now)).toBe('opus')
  expect(keepWarm('fable', { opus: big }, now)).toBe('fable')
  // Nothing to lose: new chat, small chat, or the cache has lapsed.
  expect(keepWarm('sonnet', {}, now)).toBe('sonnet')
  expect(keepWarm('sonnet', { opus: { tokens: 4_000, at: now - 60_000 } }, now)).toBe('sonnet')
  expect(keepWarm('sonnet', { opus: { tokens: 80_000, at: now - CACHE_TTL_MS - 1 } }, now)).toBe('sonnet')
  // Sonnet read most of this chat a few minutes ago, so going back to it re-reads little.
  expect(keepWarm('sonnet', { opus: big, sonnet: { tokens: 75_000, at: now - 300_000 } }, now)).toBe('sonnet')
  expect(keepWarm('sonnet', { opus: big, sonnet: { tokens: 20_000, at: now - 300_000 } }, now)).toBe('opus')
})

test('chores go to sonnet', () => {
  expect(routeByRules('add a reminder to the dashboard for my lab report')?.tier).toBe('sonnet')
  expect(routeByRules('remind me to call mom friday')?.tier).toBe('sonnet')
  expect(routeByRules('thanks!')?.tier).toBe('sonnet')
})

test('real work goes to opus', () => {
  expect(routeByRules('make the ipad worksheet for ECE306 hw 5')?.tier).toBe('opus')
  expect(routeByRules('browse the web for co-op openings at GE Aerospace')?.tier).toBe('opus')
  expect(routeByRules('can you look up when the career fair is and add a reminder')?.tier).toBe('opus')
})

test('unclear prompts fall through to the classifier', () => {
  expect(routeByRules('I need to sort out my plans for the weekend with friends')).toBe(null)
})

test('follow-ups keep the model of the task they continue', () => {
  expect(routeByRules('continue', 'opus')?.tier).toBe('opus')
  expect(routeByRules('ok keep going', 'opus')?.tier).toBe('opus')
  expect(routeByRules('yes do it', 'sonnet')?.tier).toBe('sonnet')
  expect(routeByRules('continue')?.tier).toBe('opus')
  expect(routeByRules('fix the second one', 'opus')?.tier).toBe('opus')
})

test('real-work words beat weak chore words', () => {
  expect(routeByRules('is this code ok')?.tier).toBe('opus')
  expect(routeByRules('debug why delete fails in my script')?.tier).toBe('opus')
  expect(routeByRules('explain when is the exam curve applied')?.tier).toBe('opus')
  expect(routeByRules('rename the lab folder')?.tier).toBe('sonnet')
})

test('asking for fable by name goes to fable', () => {
  expect(routeByRules('use fable to explain this circuit')?.tier).toBe('fable')
  expect(routeByRules('fable: add a reminder for friday')?.tier).toBe('fable')
  expect(routeByRules('answer with claude fable please')?.tier).toBe('fable')
  expect(routeByRules('switch to Fable 5.2')?.tier).toBe('fable')
  expect(routeByRules('write a fable for my english class')?.tier).toBe('opus')
  expect(routeByRules('yes do it', 'fable')?.tier).toBe('fable')
  expect(routeByRules('fix the second one', 'fable')?.tier).toBe('fable')
})

test('chore words in a long question do not make it a chore', () => {
  const q = 'for the model router does it know when i say something like continue that it shouldnt use sonnet ' +
    'for that entire task, ok and will it switch once it realizes or does it only go off the length of the prompt'
  expect(routeByRules(q)?.tier).not.toBe('sonnet')
})

test('misses found by the 2026-11-16 benchmark', () => {
  // Fable by name, phrased other ways; the story is still not the model.
  expect(routeByRules('have Fable do this')?.tier).toBe('fable')
  expect(routeByRules('ask fable to review my essay')?.tier).toBe('fable')
  expect(routeByRules('can fable handle this one? make my worksheet')?.tier).toBe('fable')
  expect(routeByRules('i want fable for this one')?.tier).toBe('fable')
  expect(routeByRules('the tortoise and the hare is my favorite fable, thanks')?.tier).toBe('sonnet')
  expect(routeByRules('i want fable ideas for my english class')?.tier).not.toBe('fable')
  // Adding a part of an app is coding; being reminded how something works is explaining.
  expect(routeByRules('add a dark mode to the dashboard')?.tier).toBe('opus')
  expect(routeByRules('add office hours to my calendar thursday 2pm')?.tier).toBe('sonnet')
  expect(routeByRules('remind me how convolution works')?.tier).toBe('opus')
  expect(routeByRules("remind me what's due friday")?.tier).toBe('sonnet')
  // Ticking something off is a chore even with a course code in it.
  expect(routeByRules('mark the ECE306 quiz as done')?.tier).toBe('sonnet')
  // An acknowledgement that keeps going continues the task; one on its own is a chore.
  expect(routeByRules('thanks, now do the same for chapter 8', 'opus')?.tier).toBe('opus')
  expect(routeByRules('ok now make it handle negative numbers too', 'opus')?.tier).toBe('opus')
  expect(routeByRules('ok cool', 'opus')?.tier).toBe('sonnet')
})

test("the app's own reminder blocks are not routed on", () => {
  const raw = '<system-reminder>\nCLAUDE.md contents, a reminder\n</system-reminder>\nwhy does my fourier series not converge'
  expect(typedText(raw)).toBe('why does my fourier series not converge')
  expect(routeByRules(typedText(raw))?.tier).toBe('opus')
})
