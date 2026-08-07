# Third-party notices

## Pikit chat-input

Portions of `extensions/ui/chat-input.ts`, `extensions/ui/chat-input-config.ts`, and `extensions/ui/chat-input-utils.ts` are adapted from the `chat-input` extension in [adrianapan/pikit](https://github.com/adrianapan/pikit), revision [`7b6040512b8d005fe5035a60c321b2a0d71b1679`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/chat-input).

Upstream author: Adrian Apan  
Upstream package: `@adrianapan/pikit`  
Upstream declared license: MIT

The upstream implementation has been adapted to use this package's always-on, disposable UI lifecycle and the currently active Pi theme. Its boxed input rendering, configuration behavior, color handling, and companion animation remain derived from the upstream work.

The MIT license copied in `LICENSE` and this notice are retained for the adapted Pikit UI code.

## Curated Pi themes

`themes/flexoki-dark.json`, `themes/everforest-dark-hard.json`, `themes/gruvbox-dark.json`, `themes/kanagawa-wave.json`, and `themes/vesper.json` are adapted from [victor-software-house/pi-curated-themes](https://github.com/victor-software-house/pi-curated-themes), revision [`ac8e0c8e890a8ee6ae926c6a195f16b9f0033bbb`](https://github.com/victor-software-house/pi-curated-themes/tree/ac8e0c8e890a8ee6ae926c6a195f16b9f0033bbb).

Upstream package: `@victor-software-house/pi-curated-themes`  
Upstream declared license: MIT  
Palette source: [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes), MIT

The local copies only update the Pi theme schema URL to the current `earendil-works/pi` location.

## Poimandres Pi theme

`themes/poimandres.json` is adapted from [llttlltt/poimandres-pi](https://github.com/llttlltt/poimandres-pi), revision [`4353a6250c47a642df2e27aa04b766f98be34a40`](https://github.com/llttlltt/poimandres-pi/tree/4353a6250c47a642df2e27aa04b766f98be34a40).

Upstream package: `@llttlltt/poimandres-pi`  
Upstream declared license: MIT  
Palette source: [drcmda/poimandres-theme](https://github.com/drcmda/poimandres-theme), MIT

The local copy is otherwise unchanged.

## Dracula Pi theme

`themes/dracula.json` is adapted from `pix-dracula.json` in [xynogen/pix-mono](https://github.com/xynogen/pix-mono), revision [`9cb3f2da7081499e4cee2691279673aa71bce208`](https://github.com/xynogen/pix-mono/tree/9cb3f2da7081499e4cee2691279673aa71bce208/packages/pix-themes).

Upstream package: `@xynogen/pix-themes`  
Upstream declared license: MIT  
Palette source: [Dracula Theme](https://draculatheme.com/)

The local copy renames the Pi theme from `pix-dracula` to `dracula` and updates its schema URL; its color mapping is otherwise unchanged.

## Ayu Pi themes

`themes/ayu-dark.json`, `themes/ayu-mirage.json`, and `themes/ayu-light.json` are adapted from [iodic/pi-ayu-themes](https://github.com/iodic/pi-ayu-themes), revision [`24d2c0ab27eae281407ea15b3823b172545c58d3`](https://github.com/iodic/pi-ayu-themes/tree/24d2c0ab27eae281407ea15b3823b172545c58d3).

Upstream package: `pi-ayu-themes`  
Upstream declared license: MIT  
Palette source: [ayu-theme/ayu-colors](https://github.com/ayu-theme/ayu-colors), MIT

The local copies only update the Pi theme schema URL to the current `earendil-works/pi` location.
