# Benchmarks

What the router was measured against, and how to repeat it. Everything here ran on 2026-11-16 with Sonnet 5.5,
Opus 5.5 and Fable 5.2.

## Scripts

| Script | What it does | Cost |
|---|---|---|
| `bench.mjs` | 78 labelled prompts through the rules; 11 tasks on each of the three models; a mid-chat model-switch test. Writes `results.json` | real usage |
| `analyze.mjs` | Prints the tables from `results.json` | free |
| `recheck.mjs` | Re-scores the 78 prompts against the current rules | free |
| `effort.mjs` | 4 tasks on Opus at medium, high and xhigh effort. Writes `effort-results.json` | real usage |
| `usage.mjs` | Reads your own session transcripts: usage by model, by token type, by the router's reason, and what cold re-reads cost | free |
| `e2e/e2e.mjs` | Runs the plugin in the real engine through several prompts, with a probe plugin logging beneath it | real usage |

Run them from the repo root, for example `node bench/analyze.mjs`. The ones that cost usage need the `claude` CLI
signed in. Run folders go to `bench/runs/`, which git ignores.

## Results

### Routing accuracy

78 prompts labelled by hand with the model a sensible router should pick.

| | Correct |
|---|---|
| 0.2.2 | 69 of 78 |
| 0.2.3 and later | 78 of 78 |

The nine misses are listed in the changelog under 0.2.3. The rules were tuned against this same set, so 78 of 78
means those misses are fixed; it is not a general accuracy figure. Fourteen prompts fell through to the
classifier, which got 13 right at about $0.0008 each.

### The same tasks on each model

Five quick chores and six real-work tasks, each run once per model in a fresh chat. Every run passed its check.

| | Total | Chores | Real work | Total tokens |
|---|---|---|---|---|
| Router | $0.57 | $0.12 | $0.46 | 239,974 |
| Always Opus | $0.68 | $0.23 | $0.46 | 225,097 |
| Always Fable | $1.46 | $0.54 | $0.92 | 258,137 |
| Always Sonnet | $0.29 | $0.12 | $0.17 | 239,823 |

The router does not use fewer tokens; it pays less per token on chores. Sonnet also passed all six real-work
tasks, but they were small and the checks were simple pass or fail.

### Switching models mid-chat

The extra cost of one quick question as the second turn of a chat, staying on the warm model against switching
down. This is what `keepWarm` is for.

| Chat so far | Stay | Switch down |
|---|---|---|
| 45k tokens on Opus | $0.013 | Sonnet $0.165 |
| 7k tokens on Opus | $0.011 | Sonnet $0.017 |
| 46k tokens on Fable | $0.016 | Opus $0.342, Sonnet $0.171 |

### Which model a compaction runs on

A chat whose requests were all routed to Sonnet, in a session whose own model was Haiku, was compacted with
`/compact`. The summary request ran on Haiku and read almost nothing from the cache: 1,670 tokens read, 29,397
written and 26,605 sent as plain input, for a 55,681-token chat. With the session's model the same as the one
that answered, the same compaction read 55,829 tokens from the cache.

So a compaction runs on the session's own model and does not pass through `turn.step`. The router compacts only
when that model is the one that just answered.

### Lowering effort for one message

A 16k-token chat, then one turn at low effort instead of medium. The cache held on all three models: about 16k
to 17k tokens read from the cache and 22 to 63 written.

### Effort levels

Four tasks on Opus (a circuit problem, a sampling problem, a bug fix, a short essay), once each.

| Effort | Output tokens | List cost | Time | Correct |
|---|---|---|---|---|
| medium | 3,143 | $0.19 | 58 s | 4 of 4 |
| high | 5,083 | $0.23 | 72 s | 4 of 4 |
| xhigh | 7,866 | $0.29 | 97 s | 4 of 4 |

### End to end

`e2e/e2e.mjs` with a lowered compaction threshold, on Sonnet and on Opus:

- chores and "thanks!" went out at low effort, including a chore kept on warm Opus; real work stayed at medium
- a new task in a 16.8k-token chat was followed by one compaction to 1.3k tokens, read from the warm cache
- the next question about that task was answered correctly from the compacted chat
- "continue" and "thanks!" did not trigger a compaction; neither did a session whose own model differed from the
  routed one

## Limits

- Costs are the list-price figures the CLI reports. On a subscription they stand in for plan usage.
- Each task ran once per model. The tasks are small and the checks are simple.
- The benchmark runs in the headless CLI, not inside the desktop app, where the fixed prompt is much larger; costs
  and switch penalties are higher there.
- `bench.mjs` applies the router's rules itself and simulates the classifier with Haiku. `e2e/e2e.mjs` is the one
  that loads the plugin in the engine.
- The chores are file-based stand-ins (no calendar or reminder tools), so nothing real is created.
- The one-hour idle rule is unit-tested only.
