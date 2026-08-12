# Bundled Pi theme palette audit

**Status:** remediated locally. The findings below describe the imported mappings before correction; the five affected theme files now use theme-specific semantic roles, locked by `test/theme-semantic-mapping.test.ts`.

## Conclusion

There was no evidence that one literal orange value was pasted into every theme. There **was** a related generation problem: the five themes imported from `pi-curated-themes` shared one generic 51-token mapping, and its automatically selected `accent` was fanned out across many unrelated Pi roles. This made several named themes feel unlike their canonical upstream appearance.

Before remediation, the local copies matched their documented source revisions except for the documented schema/name changes. The questionable mappings therefore originated upstream in the generated ports, not in a later local bulk edit.

## Provenance and structural evidence

The following local files are identical to `victor-software-house/pi-curated-themes` revision `ac8e0c8e890a8ee6ae926c6a195f16b9f0033bbb`, apart from `$schema`:

- `flexoki-dark.json`
- `everforest-dark-hard.json`
- `gruvbox-dark.json`
- `kanagawa-wave.json`
- `vesper.json`

All five have the same raw mapping for all 51 color tokens. Eight tokens directly point at one generated `accent`:

- `accent`
- `borderAccent`
- `customMessageLabel`
- `mdCode`
- `mdListBullet`
- `syntaxKeyword`
- `thinkingHigh`
- `bashMode`

Three more roles derive from that accent through `accentDark` or `accentMid`: `mdCodeBlockBorder`, `thinkingLow`, and `thinkingMedium`.

The source generator selects a saturated cursor color when available; otherwise it chooses the ANSI candidate maximizing a saturation/luminance score. That is a generic heuristic, not a theme-specific semantic decision. Source: [`generate-pi-themes.py`](https://github.com/victor-software-house/pi-curated-themes/blob/ac8e0c8e890a8ee6ae926c6a195f16b9f0033bbb/scripts/generate-pi-themes.py).

## Theme-by-theme verdict

| Theme | Current global accent | Verdict | More faithful global accent candidate |
|---|---:|---|---:|
| `slop` | `#d67858` | Intentional terracotta identity. | Keep |
| `flexoki-dark` | `#3aa99f` | Corrected from generator-selected yellow `#d0a215`. Cyan now follows the official VS Code port's buttons and badges while syntax roles retain the full palette. | Applied |
| `everforest-dark-hard` | `#a7c080` | Corrected from orange `#e69875`. Everforest explicitly describes itself as green-based and uses green `#a7c080` for `statusline1`/selection emphasis. | Applied |
| `gruvbox-dark` | `#fabd2f` | Bright yellow is canonical and consistent with Gruvbox's warm identity. The global choice was retained while syntax roles were corrected. | Applied |
| `kanagawa-wave` | `#7e9cd8` | Corrected from near-canonical carp yellow `#e6c283`. Crystal blue now carries UI focus while keywords remain violet and operators remain yellow. | Applied |
| `dracula` | `#bd93f9` | Correct, recognizable purple focus. | Keep |
| `ayu-dark` | `#e6b450` | Exact official `common.accent.tint`. | Keep |
| `ayu-mirage` | `#ffcc66` | Exact official `common.accent.tint`. | Keep |
| `ayu-light` | `#ff9940` | Exact official `common.accent.tint`. | Keep |
| `vesper` | `#ffc799` | Corrected from mint `#99ffe4`. Peach now follows official focus borders, buttons, selections, links, and functions; mint remains on strings/success, gray on keywords/operators, and red on errors. | Applied |
| `poimandres` | `#5de4c7` | Canonical mint emphasis and consistent with the upstream theme. | Keep |

## Implemented correction

The remediation did not globally replace every warm accent. The Ayu family, Gruvbox, and Slop remain intentionally warm.

The five generated curated ports now use theme-specific semantic mappings:

1. **Everforest:** green UI focus, canonical dark-palette success/error/warning and syntax roles.
2. **Kanagawa Wave:** blue UI focus; violet keywords; blue functions; green strings; yellow operators.
3. **Vesper:** peach UI focus/functions, mint strings/success, gray keywords/operators, red errors.
4. **Flexoki:** cyan UI focus with the official VS Code port's green keywords, orange functions, cyan strings, purple numbers, and yellow types.
5. **Gruvbox:** warm yellow UI focus retained, with canonical red keywords, green functions/strings, purple numbers, and yellow types.

## Primary sources

- Everforest: [README](https://github.com/sainnhe/everforest) and [canonical palette/statusline roles](https://github.com/sainnhe/everforest/blob/master/autoload/everforest.vim)
- Flexoki: [official palette and semantic role guide](https://stephango.com/flexoki) / [source repository](https://github.com/kepano/flexoki)
- Gruvbox: [canonical source palette](https://github.com/morhetz/gruvbox/blob/master/colors/gruvbox.vim)
- Kanagawa: [palette](https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/colors.lua) and [Wave semantic mappings](https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/themes.lua)
- Vesper: [official VS Code theme](https://github.com/raunofreiberg/vesper/blob/main/themes/Vesper-dark-color-theme.json)
- Ayu: [official color definitions](https://github.com/ayu-theme/ayu-colors/tree/master/themes)
- Dracula: [official palette](https://github.com/dracula/dracula-theme)
- Poimandres: [official theme source](https://github.com/drcmda/poimandres-theme)
