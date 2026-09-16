# pi-extensions

Private [pi](https://github.com/earendil-works/pi) extensions.

| Extension | What it does |
|---|---|
| `subagent.ts` | Starts a background consultation with a stronger read-only model (`openrouter/openai/gpt-6-astra`, `--thinking max`). The tool returns a job id immediately and the answer arrives later as a follow-up message, so it never blocks the parent turn. Slash commands: `/subagent`, `/subagents`, `/subagent-kill`. |
| `tps.ts` | Tokens-per-second meter in the status line. |

## Install

Symlink the extensions into pi's user extension directory:

```sh
ln -sf ~/pi-extensions/subagent.ts ~/.pi/agent/extensions/subagent.ts
ln -sf ~/pi-extensions/tps.ts ~/.pi/agent/extensions/tps.ts
```

Then run `/reload` in pi.

## Notes

- `subagent` jobs are in-memory and do not survive `/reload` or a session switch; `session_shutdown` kills them.
- The child runs with `--tools read,grep,find,ls` and cannot modify files.
