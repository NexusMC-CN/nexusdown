# Third-party notices

Notices for third-party code and icons included in nexusdown's distributed
sources and bundles.

## Pele 1.7.0 (MIT)

Source: [obsidianmd/pele](https://github.com/obsidianmd/pele/tree/1.7.0).

The Pele engine is bundled into the CommonJS builds of the main, `/render`,
and `/cm` entries. Their ESM builds import the `pele` dependency. The adapted
text-measurement code in `src/shared/diagram-metrics.ts` ships as source and
is included in both formats of those entries.

The following is Pele 1.7.0's [upstream license](https://github.com/obsidianmd/pele/blob/1.7.0/LICENSE),
including its attribution of the `rotate-ccw` icon to Lucide 1.14.0 (ISC).
The reference to zoom controls describes Pele's own controls.

MIT License

Copyright (c) 2026 kepano

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

The reset icon of the zoom controls is "rotate-ccw" from Lucide v1.14.0
(https://lucide.dev), under the ISC License:

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## VSCode Icons

Source: [vscode-icons](https://github.com/vscode-icons/vscode-icons), obtained
through the [Iconify API](https://api.iconify.design/). The generator does not
record an upstream version.

The file-type SVGs in `src/cm/widgets/code-icons.ts` are included in the main,
`/render`, and `/cm` builds in both formats. `scripts/build-code-icons.mjs`
normalizes their whitespace for inline embedding.

Attribution: Roberto Huertas and the vscode-icons contributors. The upstream
[license section](https://github.com/vscode-icons/vscode-icons#license)
distinguishes MIT-licensed source code from icons licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and states that
branded icons are licensed under their respective copyright licenses.
