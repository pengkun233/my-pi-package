# my-pi-package

Private personal [Pi](https://pi.dev) package for reproducing this setup on another machine. It bundles an always-on TUI, a session-scoped Loop scheduler with a model-invoked skill, progressive memory, OpenAI usage, two user-invoked skills, three prompt templates, eleven selectable themes, an installer-managed global voice-input preference, and the preferred Herdr configuration. It contains no credentials, sessions, memory data, or other machine state.

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
- installs `git:github.com/mattpocock/skills@release/v1.2` with only the exact 15 configured skills enabled; the branch folds the former `batch-grill-me` workflow into `grilling`;
- normalizes Plannotator to an ordinary enabled package entry;
- sets the global Pi theme to `slop` while preserving unrelated settings;
- installs the voice-input policy as a managed block in `~/.pi/agent/AGENTS.md`, preserving unrelated global instructions;
- installs `config/herdr/config.toml` to `~/.config/herdr/config.toml`, keeping the previous file as `config.toml.backup-before-my-pi-package` when its contents change;
- installs the RTK executable with the official Linux installer only when it is missing;
- warns about legacy duplicate resources but never deletes or moves them.

Re-running it is safe. Run it again whenever `config/packages.json` changes. Package installation is not transactional: if a network install fails midway, fix the problem and rerun the script. Restart Pi after installation.

## Bundled resources

### Skills

The model-invoked `loop` skill translates natural-language scheduling, status, and cancellation requests into the Loop tools. `/skill:loop` loads it explicitly when needed.

Two other bundled skills are user-invoked only:

- `/skill:wait-what-cn` re-pitches the previous response in concise technical Chinese, adds missing context, and preserves the current project's domain language.
- `/skill:tidy-memory` periodically audits project memory against read-only repository evidence, merging duplicate knowledge and removing stale material. `/Neat-Freak` handles routine end-of-session updates to `ai_docs/` and newly learned memory. `README.md` is generated or updated only after a human explicitly declares a project or milestone complete; repository `CLAUDE.md` and `AGENTS.md` files remain human-maintained and read-only to both workflows.

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

### Loop

`extensions/loop/` provides one in-memory repeating prompt for the current interactive session:

- natural-language requests are the primary interface, for example: “Check the deploy every 5 minutes and stop when it succeeds” or “Stop the current Loop”;
- the `loop` skill creates a self-contained check with an observable completion condition, and the agent calls `loop_stop` as soon as that condition is met;
- requests may optionally limit the Loop by successful check count or elapsed time;
- `/loop 5m check the deploy`, `/loop status`, and `/loop stop` remain available as the original direct interface;
- status shows the prompt, interval, dispatched check count, creation time, next run, and configured bounds;
- the footer shows a compact text status such as `↻ 5m · 09:30`; next-day runs include the date, for example `↻ 5m · 08-05 09:30`;
- all displayed creation, next-run, and expiry times use Beijing time (`UTC+8`), independent of the machine's local timezone;
- a tick is skipped when the main agent is busy, and all Loop state and footer status are discarded on reload or session shutdown;
- stopping cancels future runs without aborting work already in progress.

Loop publishes background activity through the terminal-status plugin's generic event contract. The terminal-tab title shows `🟣 等待中` whenever a Loop is active or a foreground/background `pi-subagents` run is detected. Input-required and error states retain higher priority.

### Memory

`extensions/memory/` provides progressive-disclosure global/project memory indexes, the `memory` tool, `/memory`, and `/remember`. Runtime data remains under `~/.pi/agent/memory/` (or `PI_MEMORY_DIR`) and is never part of this repository.

### OpenAI usage

`extensions/openai-usage.ts` provides `/usage` for a logged-in `openai-codex` account. It reads credentials through Pi at runtime and does not store or package them.

### Global voice-input preference

`config/global-agents.md` is installed into a clearly marked, package-managed block in `~/.pi/agent/AGENTS.md`. This makes the voice-input tolerance rules active by default in every Pi session. Existing instructions outside that block are preserved, and rerunning `install.sh` updates the managed block idempotently.

Pi packages do not natively expose `AGENTS.md` as a manifest resource, so this policy is applied by the installer rather than the `pi.prompts` manifest. After changing or updating `config/global-agents.md`, rerun `install.sh`, then run `/reload` or restart Pi. `pi update --extensions` alone does not refresh this managed block.

### Herdr configuration

`config/herdr/config.toml` is the reproducible Herdr preference file installed by `install.sh`. It includes the Dracula theme, direct workspace/tab/agent navigation keys, the `prefix+a` Pi-agent launcher command, expanded agent-row formatting, and disabled persisted pane history. The launcher binding expects `~/.local/bin/herdr-new-pi` to exist on the target machine; that machine-local helper is not bundled.

Set `PACKAGE_HERDR_CONFIG_TARGET` when running the installer to write the config somewhere other than `~/.config/herdr/config.toml`.

### Prompts and theme

Prompt templates:

- `/Get-Shit-Done`
- `/Neat-Freak`
- `/aye`

Bundled themes:

- `slop` (the installer-selected default)
- `flexoki-dark`
- `everforest-dark-hard`
- `gruvbox-dark`
- `kanagawa-wave`
- `dracula`
- `ayu-dark`
- `ayu-mirage`
- `ayu-light`
- `vesper`
- `poimandres`

They are ordinary package themes discovered from `themes/`. `install.sh` selects `slop` globally; users can select any bundled theme later through `/settings`.

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
