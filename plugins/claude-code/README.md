# detour

Fork your Claude Code conversation for a side question, see every fork as a tree beside the chat, and come back to where you were.

## Install

At the prompt of a Claude Code session:

```
/plugin install detour --marketplace pjw81226/detour
```

## Commands

- `/side <question>` forks the conversation at this point and sends the question in the fork. If Claude is still answering, the fork waits until the turn ends.
- `/back` returns to the session you forked from, at the point where you left it. Nothing from the fork is copied back.
- `/tree` opens a pane with the forks of this session. Click a row to switch to that session, or use `rename` to give it a name.

While you are in a fork, the line above the prompt reads `fork: <title> | /back to return`.

## What it runs, reads and stores

- It runs Claude Code's own `/branch` and `/resume` commands to create and switch sessions, and sends your `/side` question as a prompt in the new fork.
- It reads the current session's transcript file on your machine, read only, to find where a session made with `/branch` was split.
- It keeps a small record per fork in Claude Code's plugin storage on your machine: the session ids, the fork's title or the name you gave it, when it was made, whether you went back, and the paths of files edited with Edit, Write or NotebookEdit while in the fork, so `/back` can list them.
- It sends nothing over the network and collects no telemetry.

## Good to know

- Only the conversation forks. Files you edit in a fork stay edited.
- If you press Esc while `/side` is waiting, Claude Code pauses plugin input until you type again. detour puts `/side <question>` back in the prompt box, so pressing Enter finishes it.
- Tested on Claude Code 2.1.330.

Source, issues and a demo: https://github.com/pjw81226/detour

MIT license.
