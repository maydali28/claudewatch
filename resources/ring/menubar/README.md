# claudewatch · Ring — macOS menu bar (template) icons

These are **template images** — pure black glyph on transparent background. macOS automatically tints them for light/dark menu bars, so you never ship two variants. Standard menu bar height is **22pt**.

## Files

| File | Size | Purpose |
|---|---|---|
| `claudewatch-ringTemplate.svg` | vector | Master — scales losslessly |
| `claudewatch-ringTemplate.png` | 22×22 | @1x — non-retina displays |
| `claudewatch-ringTemplate_2x.png` | 44×44 | @2x — retina (rename to `@2x`, see below) |
| `claudewatch-ringTemplate_3x.png` | 66×66 | @3x — future-proof / ProDisplay XDR |
| `claudewatch-ringTemplate-16.png` | 16×16 | extra — tray / compact contexts |
| `claudewatch-ringTemplate-32.png` | 32×32 | extra — high-density tray |

## Important — rename before shipping

The project filesystem disallows `@` in paths, so the retina files are stored with `_2x` / `_3x`. **Rename them to Apple's convention before you bundle:**

```
claudewatch-ringTemplate_2x.png  →  claudewatch-ringTemplate@2x.png
claudewatch-ringTemplate_3x.png  →  claudewatch-ringTemplate@3x.png
```

Or a one-liner:

```sh
cd icons/ring/menubar
mv claudewatch-ringTemplate_2x.png claudewatch-ringTemplate@2x.png
mv claudewatch-ringTemplate_3x.png claudewatch-ringTemplate@3x.png
```

## Usage

### Swift / AppKit (NSStatusItem)

```swift
let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
if let button = item.button {
    let image = NSImage(named: "claudewatch-ringTemplate")  // filename sans extension & scale suffix
    image?.isTemplate = true        // critical — enables auto-tinting
    button.image = image
}
```

Add all three PNGs to your asset catalog (or Resources folder) with the `@2x`/`@3x` naming and AppKit picks the right one automatically.

### Electron / Tauri

```js
// Electron
const { Tray, nativeImage } = require('electron');
const img = nativeImage.createFromPath('claudewatch-ringTemplate.png');
img.setTemplateImage(true);   // critical
const tray = new Tray(img);
```

## Why template images?

Template images are **monochrome by design**. The pure-black glyph gets tinted by macOS to match the menu bar's active state (black on light menu bar, white on dark, blue when highlighted). Shipping a colored icon there breaks that system and looks out of place.

The color Ring variant (from the main app icon) is in `../` — use that for the Dock, Finder, and About window. Use these template PNGs for the menu bar only.
