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
   - Fable by name ("use fable", "fable: ...", "switch to Fable 5.2"); "write a fable" does not count
   - Web browsing or lookups go to Opus
   - Short follow-ups ("continue", "yes", "do it") stay on the model of the task they continue
   - Clear chores (reminders, calendar adds) go to Sonnet, but only in prompts of 20 words or fewer
   - Real-work words (coding, homework, research, writing, documents) go to Opus
   - Weak chore hints ("ok", "rename", "thanks") go to Sonnet only if nothing above fired
2. **LLM classifier.** If no rule fires, a fast model answers one question: quick chore or real task?
3. **Safe default.** If the classifier fails, Opus. A wrong pick upward costs a little money; a wrong pick downward costs a bad answer.

Two corrections run after the pick:

- **Escalation.** A Sonnet "chore" still working after 4 model requests is not a chore; it moves to Opus for the rest of the task.
- **Cache awareness** (`keepWarm`). The prompt cache is per model. A model that has not read this chat pays for all of it again, while the model that just answered re-reads it at about 10% of the price. So a move to a cheaper model is skipped when it would have to re-read more than about 10k tokens of a chat whose cache is still warm. Moves up are never held back.

## Commands

The status line shows the current pick and why.

- `/route opus`, `/route sonnet`, `/route fable`: lock to one model
- `/route auto`: back to automatic
- `/route`: show the mode, the last pick and which model actually answered

## Layout

```
.claude-plugin/plugin.json   plugin manifest
hooks/hooks.json             registers hooks/register.ts
hooks/register.ts            the hooks: prompt.submit (pick), turn.step (switch model, escalate, track cache), /route command
hooks/route.ts               pure routing logic: keyword rules, keepWarm, classifier prompt
hooks/route.test.ts          unit tests for the routing logic
types/index.d.ts             Tier / Mode / Pick types and the plugin's stored state
```

The routing logic in `route.ts` is pure functions with no I/O, which is what makes it easy to test; `register.ts` is the thin layer that reads and writes state and talks to the app.

## Tuning

- Keyword lists: `hooks/route.ts`
- `CHORE_MAX_WORDS` (20): longest prompt a chore keyword counts in
- `ESCALATE_AT_STEP` (4) in `hooks/register.ts`
- `CACHE_TTL_MS` (1 hour) and `SMALL_REREAD_TOKENS` (10k) for cache awareness

## Tests

`hooks/route.test.ts` covers chores, real work, follow-ups, Fable by name (and "write a fable" not counting), long questions that happen to contain chore words, and the cache rule. Run them with the plugin test runner in Claude Code.
