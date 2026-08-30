# Prompt Snippets

Mix-and-match single-purpose prompt rules that are prepended or appended to
your message when you send it. Unlike skills, each snippet is a tiny,
standalone instruction — toggle exactly the ones you want per message.

## Usage

- Press **alt+shift+s** or run **/snippets** to open the toggle menu.
  - `up`/`down` to navigate, `space` to toggle, `enter` to apply, `esc` to cancel.
  - `tab` previews the highlighted snippet (name, placement, order, filename,
    and full body; `up`/`down` scroll long bodies). `tab` or `esc` returns to
    the list with your cursor position preserved.
  - The menu is framed with top/bottom border lines and scrolls when the list
    exceeds the viewport (max height adapts to your terminal), with
    `↑ n more` / `↓ n more` indicators when clipped.
- Active snippets show up as a widget above the editor:
  - `↑ prepend: ...` (accent color) — inserted before your message
  - `↓ append: ...` (warning color) — inserted after your message
- When you send a message, active snippet bodies are merged into the message
  text: prepend group (sorted by `order`) → your text → append group (sorted
  by `order`), separated by blank lines.
- Toggles reset to **all off** after each send and at session start.

## Snippet files

The extension merges two directories:

1. Packaged defaults in `snippets/` next to `index.ts`.
2. Machine-local snippets in `~/.pi/agent/snippets/`.

A local file overrides a packaged default with the same filename. Every
snippet is one Markdown file with frontmatter:

```markdown
---
name: Concise
description: Keep answers short and to the point
placement: prepend
order: 10
---
Keep your response concise. Skip preamble and unnecessary explanation.
```

| Field | Required | Notes |
|---|---|---|
| `name` | no | Display name; defaults to the filename without `.md` |
| `description` | no | Shown next to the name in the toggle menu |
| `placement` | no | `prepend` or `append` (default: `append`) |
| `order` | no | Number; sorts snippets within their group, in the menu and in the applied text (default: `9999`, ties broken by name) |

Files are re-scanned every time the menu opens and every time a message is
sent, so edits take effect immediately — no `/reload` needed.

## Packaging and synchronization

In a Git Pi package, bundled defaults are loaded from the package checkout, for
example:

```text
~/.pi/agent/git/github.com/OWNER/my-pi-package/extensions/prompt-snippets/snippets/
```

These Markdown files are extension data, not Pi prompt templates; do not add
them to the package's `pi.prompts` manifest unless they should also appear as
slash-command prompt templates.

For snippets shared by every machine, keep them in the package's adjacent
`snippets/` directory, commit and push them, then run
`pi update --extensions` on each host. Do not edit the installed Git checkout
directly because package reconciliation can reset and clean it.

Keep private or machine-specific snippets under `~/.pi/agent/snippets/`. Pi
package updates intentionally do not manage that directory. Synchronize it
separately with a private dotfiles repository, Syncthing, or `rsync` when the
same custom snippets are wanted on several machines.

Do not leave a standalone copy under
`~/.pi/agent/extensions/prompt-snippets/` enabled after packaging the
extension, or Pi will load both copies and register duplicate commands and
shortcuts.
