# MC Texture Maker

A browser-based PWA for building **Minecraft Java Edition 1.8.9** resource packs, including the 1.8.9-era OptiFine/MCPatcher layout.

## Implemented

- ZIP import with preservation of unknown files and path traversal rejection
- Minecraft-ready ZIP export
- IndexedDB autosave and reload recovery
- Generic PNG editing for every PNG in a pack
- Non-resampling Resolution Grid editing (16/32/64/128/256/512/1024 when divisible)
- Pencil, eraser, fill, eyedropper, undo/redo
- Vanilla animation metadata studio (`.png.mcmeta`)
- 1.8.9 JSON model studio with cuboid editor and isometric preview
- OptiFine/MCPatcher Sky Studio
- CTM and CIT properties builders
- Raw JSON / `.mcmeta` / `.properties` editor
- Live validation for `pack.mcmeta`, JSON syntax, case collisions, sky references, animation metadata
- Offline-installable PWA shell
- Responsive desktop/tablet/mobile UI

## Compatibility target

- Minecraft Java Edition 1.8.9
- `pack_format: 1`
- OptiFine 1.8.9 HD U M5 / `assets/minecraft/mcpatcher/...`

## Run locally

No build step is required.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Notes

Export uses standards-compliant **stored ZIP entries** rather than recompressing PNG/OGG payloads. This trades some archive-level compression for dependency-free, offline-capable ZIP generation in the browser.
