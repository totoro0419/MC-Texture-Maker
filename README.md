# MC Texture Maker

Browser/PWA editor for **Minecraft Java Edition 1.8.9** resource packs, including OptiFine/MCPatcher-era assets.

## Core workflows

- Create a new 1.8.9 pack from a **Vanilla 1.8.9 baseline** or as a blank pack.
- One-time vanilla setup reads textures from the user's own local `1.8.9.jar`, caches them in IndexedDB, and makes them available in every vanilla-based project.
- Untouched vanilla files remain a read-only baseline; only edited overrides are stored/exported, so generated packs do not duplicate the entire vanilla asset set.
- Open existing resource-pack ZIPs, preserve unknown files, validate, edit, autosave, and export a Minecraft-ready ZIP.
- Generic PNG editing with non-resampling logical grids, undo/redo, pencil, eraser, fill, and eyedropper.
- Animation metadata, 1.8.9 model JSON, OptiFine sky, CTM/CIT helpers, and raw JSON/properties editing.
- Offline-capable PWA with responsive desktop/mobile UI.

## Compatibility target

- Minecraft Java Edition 1.8.9
- `pack_format: 1`
- OptiFine 1.8.9 HD U M5 / `assets/minecraft/mcpatcher/...`

## Vanilla asset handling

Minecraft's vanilla assets are not committed to this repository. On first use, choose the local client JAR from `.minecraft/versions/1.8.9/1.8.9.jar`. The app extracts only `assets/minecraft/textures/**` PNGs and animation metadata into local browser storage. Later projects can use that cached baseline immediately.

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
