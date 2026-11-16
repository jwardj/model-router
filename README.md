# model-router

A Claude Code plugin that picks which Claude model answers each prompt, so quick chores run on the cheap, fast model and real work gets the stronger one, without switching models by hand.

| Prompt | Model | Why |
|---|---|---|
| "remind me to call mom friday" | Sonnet | quick chore |
| "make the ipad worksheet for ECE306 hw 5" | Opus | real work |
| "look up when the career fair is and add a reminder" | Opus | web work always goes up |
| "yes do it" | same as before | follow-up to the last task |
| "use fable to explain this circuit" | Fable | asked for by name |

Written in TypeScript against the Claude Code plugin hooks API. Built with AI-assisted development (Claude), designed, tested and tuned by me against my own daily use.

## How it decides

Every prompt goes through three layers, cheapest first:

1. **Keyword rules** (`hooks/route.ts`, `routeByRules`), checked in order:
   - Fable by name ("use fable", "have fable do this", "ask fable to...", "fable: ...", "switch to Fable 5.2"); "write a fable" does not count
   - Web browsing or lookups go to Opus
   - Short follow-ups ("continue", "yes", "do it") stay on the model of the task they continue
   - Clear chores (reminders, calendar adds, marking things done) go to Sonnet, but only in prompts of 20 words or fewer
   - Real-work words (coding, homework, research, writing, documents) go to Opus. Adding a part of an app ("add a dark mode to the dashboard") and "remind me how X works" count as real work
   - Weak chore hints ("rename", "when is") go to Sonnet only if nothing above fired
   - "ok" or "thanks" alone is a chore; followed by more ("ok now do the next one") it continues the task before it
2. **LLM classifier.** If no rule fires, a fast model answers one question: quick chore or real task?
3. **Safe default.** If the classifier fails, Opus. A wrong pick upward costs a little money; a wrong pick downward costs a bad answer.

Three corrections run after the pick:

- **Escalation.** A Sonnet "chore" still working after 4 model requests is not a chore; it moves to Opus for the rest of the task.
- **Cache awareness** (`keepWarm`). The prompt cache is per model. A model that has not read this chat pays for all of it again, while the model that just answered re-reads it at a fraction of the price. So a move to a cheaper model is skipped when it would have to re-read more than about 10k tokens of a chat whose cache is still warm. Moves up are never held back. Measured on a 45k-token chat: answering one quick question by switching down cost 11 to 21 times more than staying on the warm model.
- **After an hour idle** the cache has lapsed and the chat is re-read at full price whoever answers, so a follow-up no longer inherits Fable; it goes to Opus, which re-reads for half the price. Asking for Fable by name still works.

## Saving usage beyond the pick

Most usage is not the answer; it is the chat being re-read and re-written on every request. Two things address that:

- **Low effort for chores.** A chore, or "ok" / "thanks" on its own, is answered at low effort whichever model answers it, including a chore kept on a warm Opus or Fable. Lowering effort for one message keeps the cache.
- **Compacting big chats at a new task.** When a prompt starts a task unrelated to the one before it in a chat over about 150k tokens, the router runs `/compact` right after that task's first reply, so the rest of the task does not carry the old chat on every request.

The compaction has one condition. The app compacts on the model selected in the app, not the routed one, and on a model with no cache of the chat that means re-reading all of it at full price. So the router only compacts when the selected model is the one that just answered. In practice: select Opus in the app if most of your work is routed to Opus; "use fable" still reaches Fable.

## What it saves

On 11 identical tasks (5 chores, 6 real-work tasks), with every run passing its check:

| | List cost |
|---|---|
| Router (Sonnet for chores, Opus for the rest) | $0.57 |
| Always Opus | $0.68 |
| Always Fable | $1.46 |

Chores alone were 48% cheaper than on Opus and 78% cheaper than on Fable. The saving is price per token, not fewer tokens. Method, the other tests and their limits are in [bench/README.md](bench/README.md).

## Commands

The status line shows the current pick and why.

- `/route opus`, `/route sonnet`, `/route fable`: lock to one model
- `/route auto`: back to automatic
- `/route`: show the mode, the last pick and which model actually answered

## Layout

```
.claude-plugin/plugin.json   plugin manifest
hooks/hooks.json             registers hooks/register.ts
hooks/register.ts            the hooks: prompt.submit (pick), turn.step (switch model, effort, escalate, track cache),
                             turn.complete (compact), /route command
hooks/route.ts               pure routing logic: keyword rules, keepWarm, the idle and compaction rules, classifier prompts
hooks/route.test.ts          unit tests for the routing logic
types/index.d.ts             Tier / Mode / Pick types and the plugin's stored state
bench/                       benchmarks and the end-to-end harness (see bench/README.md)
CHANGELOG.md                 what changed in each version, and why
```

The routing logic in `route.ts` is pure functions with no I/O, which is what makes it easy to test; `register.ts` is the thin layer that reads and writes state and talks to the app.

## Tuning

- Keyword lists: `hooks/route.ts`
- `CHORE_MAX_WORDS` (20): longest prompt a chore keyword counts in
- `ESCALATE_AT_STEP` (4) in `hooks/register.ts`
- `CACHE_TTL_MS` (1 hour) and `SMALL_REREAD_TOKENS` (10k) for cache awareness
- `COMPACT_ABOVE_TOKENS` (150k): chat size at which a new task triggers a compaction; `Infinity` turns it off

## Tests

`hooks/route.test.ts` covers chores, real work, follow-ups, Fable by name (and "write a fable" not counting), long questions that happen to contain chore words, the cache rule, the idle rule and the compaction condition. Run them with `claude plugin test .` from the repo.

`bench/e2e/e2e.mjs` runs the plugin in the real engine through several prompts and logs what reached the model beneath the router: which model, at what effort, and whether a compaction ran.
