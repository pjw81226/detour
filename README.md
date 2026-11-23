# detour

Take a detour from your Claude Code session to chase a side question, then come back to exactly where you were. The side trip stays out of your main conversation.

> 한국어: [README.ko.md](README.ko.md)

## Install

At the prompt of a Claude Code session:

```
/plugin install detour --marketplace pjw81226/detour
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install detour --marketplace pjw81226/detour`.

To try a local checkout instead: `claude --plugin-dir /path/to/detour/plugins/claude-code`. Tested on Claude Code 2.1.330.

## Usage

1. `/side why does this filter run twice?`
   Branches the conversation here and asks the question in the branch. If Claude is busy, it waits until the turn ends.
2. Dig in. The branch is a full session, so every tool works.
3. `/back`
   Takes you straight back to where you left off in the main session. Nothing from the branch is carried over. If something you found matters, just tell Claude in the main session.

`/tree` lists the branches of the current session. Pick one to switch to it, or press 이름 바꾸기 (rename) next to it to give it a new name.

While you are in a branch, the line above the prompt shows `곁가지: <title> | /back 으로 메인에 돌아가기`. The UI text is Korean for now.

## Good to know

- Only the conversation branches. Files you change in a branch stay changed, and you get a notice listing them when you go back.
- If you press Esc while `/side` is waiting, Claude Code holds plugin input until you type again, so `/side <question>` is put back in the prompt box. Press Enter.
- `/back` also works in a session you split with the built-in `/branch`.

## Development

```bash
claude plugin test plugins/claude-code       # unit tests
claude plugin validate plugins/claude-code   # structure and API use
python3 -I scripts/e2e.py                    # real round trip in a separate Claude Code (a few model calls)
python3 -I scripts/test_e2e.py               # the e2e cleanup itself
```

`scripts/e2e.py` removes its test folder, test sessions and plugin records, even when interrupted. It leaves the test folder's entry in `~/.claude.json` and its lines in `~/.claude/history.jsonl`, because a running Claude Code shares those files.

## License

MIT
