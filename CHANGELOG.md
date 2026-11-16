# Changelog

## 0.3.0 (2026-11-16)

Three changes aimed at usage rather than at the pick itself. Each was checked in the real engine; the method and
numbers are in [bench/README.md](bench/README.md).

### Added

- **Low effort for chores.** A prompt the rules or the classifier call a chore, and "ok" or "thanks" on their own,
  is answered at low effort whichever model ends up answering it. That includes a chore kept on a warm Opus or
  Fable. Lowering effort for one message kept the chat's cache on Sonnet, Opus and Fable. A follow-up that merely
  inherits Sonnet keeps its usual effort, since it may be more than the chore it follows.
- **Follow-ups stop inheriting Fable after an hour idle.** Once the cache has lapsed the chat is re-read at full
  price whichever model answers, and Opus does that for half of what Fable does. Asking for Fable by name still
  works. Follow-ups to Opus work stay on Opus.
- **Big chats are compacted at a new task.** When a prompt starts a task unrelated to the one before it (the fast
  classifier is asked, with the previous request for context) in a chat over `COMPACT_ABOVE_TOKENS` (150k), the
  router runs `/compact` right after that task's first reply. The status line says so. It only does this when the
  session's own model is the one that just answered; see the first note below.

### What the engine allows

Found while building the compaction change, and the reason it works the way it does:

- A compaction runs on the session's own model (the one selected in the app), not the routed one, and its request
  does not pass through `turn.step`, so the router cannot re-route it. On a model with no cache of the chat, the
  summary re-reads the whole chat at full price, which costs more than the compaction saves.
- `$.session.compact()` is refused inside `prompt.submit` ("it would compact under the turn this hook is
  holding"), so the old chat cannot be compacted before the new task's first reply.
- `$.session.compact()` is not available in headless and SDK sessions. `$.command.run({ command: 'compact' })`
  from `turn.complete` works there, queued to run once the session is idle.
- Right after a compaction the recorded chat size is stale until the next reply. Without a guard the next prompt
  compacts the fresh summary a second time; the `compacting` flag is that guard.
- A helper that takes `$` must be declared at the top of the hooks module, or the plugin does not validate.

## 0.2.3 (2026-11-16)

Nine routing misses found by a 78-prompt labelled benchmark: 69 of 78 correct before, 78 of 78 after. That set is
the one the rules were then tuned against, so 78 of 78 means the known misses are fixed, not a general accuracy
figure.

### Fixed

- **Fable by name, phrased other ways.** "have fable do this", "ask fable to...", "can fable handle..." and
  "want/need fable for/to/on..." now go to Fable. "write a fable" and "my favorite fable" still do not.
- **Adding a part of an app is coding.** "add a dark mode to the dashboard" went to Sonnet as a quick add; adding
  a mode, feature, button, page, tab, chart, graph, widget, panel, toggle, theme or filter now goes to Opus.
- **"remind me how X works" is not a reminder.** "remind me how/what/why/who/which..." no longer counts as a
  chore.
- **Marking something done is a clear chore.** "mark ... done", "check off" and "cross off" now win over
  real-work words, so a course code in the prompt no longer sends them to Opus.
- **An acknowledgement that keeps going continues the task.** "ok now make it handle negative numbers too" went
  to Sonnet on the word "ok"; with a task before it, it now stays on that task's model. "ok" or "thanks" alone is
  still a chore.

## 0.2.2 (2026-11-10)

First public version.

- Keyword rules in order: Fable by name, web work, follow-ups, clear chores, real work, weak chore hints.
- A fast LLM classifier when no rule fires; Opus when the classifier fails.
- Escalation: a Sonnet pick still working after 4 model requests moves to Opus.
- Cache awareness (`keepWarm`): a move to a cheaper model is skipped when the current model's cache is warm and
  the cheaper one would have to re-read more than about 10k tokens.
- `/route auto | opus | sonnet | fable`, and a status line showing the pick and why.
