# Pi Progressive Memory

A Claude Code-style progressive-disclosure memory extension for Pi.

## Behavior

- Loads compact global and project `MEMORY.md` indexes once when the session runtime starts, then injects that byte-stable snapshot through the system prompt before every user prompt.
- Keeps the injected snapshot fixed for the runtime even when memory is updated, preserving the prompt-cache prefix; startup, `/resume`, `/new`, `/fork`, and `/reload` create a fresh runtime snapshot.
- Keeps full topic documents out of context until the `memory` tool reads or searches them; tool reads and searches always use the latest on-disk data.
- Stores project memories outside the repository under `~/.pi/agent/memory/projects/`.
- Shares project memory across worktrees and, when `origin` is configured, across clones of the same remote.
- Uses atomic writes, a cross-process lock directory, secret-pattern checks, and an audit log.
- Caps the combined index payload at 200 lines / 25KB, reserving space for both global and project indexes; topic reads are capped at 50KB.

## Layout

```text
~/.pi/agent/memory/
├── global/
│   ├── MEMORY.md
│   ├── audit.jsonl
│   └── topics/*.md
└── projects/<repo>-<hash>/
    ├── MEMORY.md
    ├── audit.jsonl
    └── topics/*.md
```

Set `PI_MEMORY_DIR` to override the memory root.

## Commands

- `/memory` or `/memory status` — show current identity and stores.
- `/memory reindex [global|project|all]` — rebuild indexes from topic frontmatter.
- `/remember <note>` — append a normalized one-line user-requested note (maximum 2,000 characters) to the project inbox.
- `/remember --global <note>` — append the same kind of note to the global inbox.

The model can use the `memory` tool with these actions:

- `status`
- `search`
- `read`
- `upsert`
- `forget`
- `reindex`

`upsert` replaces the complete topic. Read an existing topic before updating it. Memory mutations update the on-disk index immediately but do not refresh the snapshot injected into the current session runtime.

## Topic format

```markdown
---
title: "Architecture decisions"
summary: "Stable module boundaries and technical choices"
tags: ["architecture", "decisions"]
updated: 2026-03-22
confidence: confirmed
---

Detailed durable notes go here.
```

Topic filenames must be lowercase slugs containing only `a-z`, `0-9`, and `-`.

## Maintenance policy

Store only durable, verified, reusable knowledge. Do not store secrets, credentials, transient task state, or guesses. Correct an existing topic rather than adding contradictory duplicates. If a process crashes while writing, verify that no Pi process is using the store before manually removing its `.lock` directory.

Run `/reload` after changing the extension source.
