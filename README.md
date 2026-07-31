# my-pi-package

Private personal [Pi](https://pi.dev) package for reproducing this setup on another machine. It bundles an always-on TUI, a discussion-only Chat Mode, progressive memory, OpenAI usage, three prompt templates, the selectable `slop` theme, and an installer-managed global voice-input preference. It contains no skills, credentials, sessions, memory data, or other machine state.

## Install

Clone the repository from GitHub, then run:

```bash
./install.sh
```

The script derives the unpinned Git package source from `origin`. Before a remote exists, supply it explicitly:

```bash
MY_PI_PACKAGE_SOURCE=git:github.com/OWNER/my-pi-package ./install.sh
```

The installer:

- registers this repository as an update-managed, unpinned Git Pi Package;
- installs the independent packages in `config/packages.json`;
- installs `git:github.com/mattpocock/skills` with only the exact 15 configured skills enabled;
- normalizes Plannotator to an ordinary enabled package entry;
- sets the global Pi theme to `slop` while preserving unrelated settings;
- installs the voice-input policy as a managed block in `~/.pi/agent/AGENTS.md`, preserving unrelated global instructions;
- installs the RTK executable with the official Linux installer only when it is missing;
- warns about legacy duplicate resources but never deletes or moves them.

Re-running it is safe. Run it again whenever `config/packages.json` changes. Package installation is not transactional: if a network install fails midway, fix the problem and rerun the script. Restart Pi after installation.

## Bundled resources

### UI

`extensions/ui/index.ts` installs one TUI lifecycle with:

- custom footer and startup header; the footer preserves every standard `setStatus()` contribution, sorts statuses by ID, and wraps overflow onto additional rows;
- boxed native editor with the companion enabled by default;
- active-theme-aware message/tool rendering and subagent styling;
- working spinner and terminal-tab status;
- `/ack` to return a settled terminal status to idle.

There is no Plan Mode, `/pikit-ui` toggle, persisted UI enable state, or runtime theme switching. The UI follows whichever Pi theme is active and disposes its editor, footer, header, timers, title status, and adapters on reload or session shutdown.

Optional machine-local overrides:

- `~/.pi/agent/configs/chat-input.json`
- `~/.pi/agent/configs/ui-footer.json`

The package defaults remain authoritative when those files are absent or invalid.

### Chat Mode

`extensions/chat-mode.ts` provides a lightweight discussion-only mode:

- enabled by default in interactive TUI sessions and reset to that default after startup, `/reload`, `/resume`, or a new session;
- toggled with `/chat` or `Ctrl+Alt+C` while the agent is idle;
- removes `edit` and `write`, adds a blocking backstop for those tool calls, and injects per-turn guidance against actions with side effects;
- preserves read, shell, search, subagent, and extension tools, so it is a guard against accidental edits rather than a security sandbox;
- leaves user-entered `!` and `!!` shell commands untouched;
- shows `💬 chat` in the footer while active.

RPC, JSON, and print sessions default to normal mode, though `/chat` can enable Chat Mode where extension commands are available. Chat Mode state is intentionally not persisted.

### Memory

`extensions/memory/` provides progressive-disclosure global/project memory indexes, the `memory` tool, `/memory`, and `/remember`. Runtime data remains under `~/.pi/agent/memory/` (or `PI_MEMORY_DIR`) and is never part of this repository.

### OpenAI usage

`extensions/openai-usage.ts` provides `/usage` for a logged-in `openai-codex` account. It reads credentials through Pi at runtime and does not store or package them.

### Global voice-input preference

`config/global-agents.md` is installed into a clearly marked, package-managed block in `~/.pi/agent/AGENTS.md`. This makes the voice-input tolerance rules active by default in every Pi session. Existing instructions outside that block are preserved, and rerunning `install.sh` updates the managed block idempotently.

Pi packages do not natively expose `AGENTS.md` as a manifest resource, so this policy is applied by the installer rather than the `pi.prompts` manifest. After changing or updating `config/global-agents.md`, rerun `install.sh`, then run `/reload` or restart Pi. `pi update --extensions` alone does not refresh this managed block.

### Prompts and theme

Prompt templates:

- `/Get-Shit-Done`
- `/Neat-Freak`
- `/tidy-memory`

`slop` is an ordinary package theme. `install.sh` selects it globally; users can select another theme later.

## Updates

Pi manages all registered unpinned packages:

```bash
pi update --extensions
```

## Development

```bash
npm ci
npm run check
npm test
npm run pack:check
npm pack --json --dry-run
```

Built and tested against Pi `0.82.1`. Renderer prototype styling is best-effort because those internals are not a stable extension API.

## Attribution

The chat-input renderer and companion animation are adapted from Adrian Apan's MIT-licensed Pikit project. See `THIRD_PARTY_NOTICES.md`.
