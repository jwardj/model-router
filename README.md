# model-router

Picks a model for every prompt you send.

- Asking for Fable by name ("use fable", "fable: ...", "with claude fable", "switch to Fable 5.2") goes to Fable; "write a fable" does not
- Fable is only used when asked for by name or locked with `/route fable`, even if Fable is selected in the app; the default is Opus
- Web browsing and lookups go to Opus
- Quick chores (reminders, dashboard or calendar adds, renames, quick questions) go to Sonnet
- Real work (worksheets, homework, coding, writing, research, documents) goes to Opus
- Follow-ups ("continue", "yes", "do it", short replies) stay on the model of the task they continue
- Chore keywords only count in short prompts (20 words or fewer); weak ones ("ok", "delete", "when is", "thanks") lose to real-work words
- Anything unclear gets a fast yes/no check; if that fails, Opus
- A Sonnet pick still working after 4 model requests switches to Opus for the rest of the task
- A pick for a cheaper model is skipped when the current model's cache is warm and the cheaper one would have to re-read more than about 10k tokens of the chat (the prompt cache is per model, so that re-read costs more than it saves). Moves up, Fable by name and `/route` locks always go through. `CACHE_TTL_MS` and `SMALL_REREAD_TOKENS` in `hooks/route.ts` tune it

The status line shows the pick and why. `/route opus`, `/route sonnet`, `/route fable` and `/route auto` override it. Plain `/route` shows the current mode, the last pick and which model actually answered.

Edit the keyword lists in `hooks/route.ts` to change the rules.
