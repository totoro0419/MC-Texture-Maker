import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const html = read('index.html');
const css = read('styles.css');
const app = read('src/app.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const sw = read('sw.js');

assert(html.includes('id="editor-main"'), 'main editor landmark missing');
assert((html.match(/role="tab"/g) || []).length === 5, 'expected exactly five workspace tabs');
for (const id of ['tab-texture','tab-animation','tab-model','tab-sky','tab-advanced']) assert(html.includes(`id="${id}"`), `missing ${id}`);
assert(html.includes('id="pack-file-input"') && html.includes('type="file"'), 'native ZIP file input missing');
assert(html.includes('id="toast-region"') && html.includes('aria-live="polite"'), 'notification live region missing');
assert(html.includes('id="new-project-dialog"') && html.includes('<dialog'), 'native project dialog missing');
assert(css.includes('--bg: #f6f7f9') && css.includes('--surface: #ffffff') && css.includes('--accent: #f6b80a'), 'bright UI token set missing');
assert(css.includes('@media (pointer: coarse)') && css.includes('min-height: 44px'), 'coarse pointer target rule missing');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion rule missing');
assert(app.includes('showModalWithFocusRestore'), 'dialog focus restoration helper missing');
assert(app.includes("setAttribute('aria-selected'"), 'tab selected-state contract missing');
assert(app.includes("panel.setAttribute('role','dialog')") && app.includes("panel.setAttribute('aria-modal','true')"), 'responsive drawer dialog semantics missing');
assert(app.includes('logicalGrid()') && app.includes('availableGrids'), 'resolution-grid implementation missing');
assert(html.includes('ZIP resource packs only') && html.includes('id="drop-overlay"'), 'file constraints/drop overlay missing');
assert(app.includes("document.addEventListener('dragenter'") && app.includes('handleDroppedFiles'), 'drag-and-drop ZIP path missing');

const iconPaths = new Set(manifest.icons.map(i => i.src));
for (const icon of ['./icons/icon-192.png','./icons/icon-512.png','./icons/icon.svg']) assert(iconPaths.has(icon), `manifest missing ${icon}`);
for (const file of ['icons/icon-192.png','icons/icon-512.png','icons/icon.svg']) assert(fs.existsSync(file), `missing ${file}`);
for (const file of ['./index.html','./styles.css','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./src/app.js','./src/zip.js','./src/storage.js','./src/validators.js']) assert(sw.includes(`'${file}'`), `service worker cache list missing ${file}`);

assert(html.includes('id="new-project-source-vanilla"'), 'vanilla new-project source missing');
assert(html.includes('id="vanilla-library-file"'), 'vanilla JAR input missing');
assert(app.includes('cacheVanillaLibraryFromJar'), 'vanilla library import flow missing');
assert(app.includes('visibleEntries()'), 'vanilla baseline overlay missing');
const storage = read('src/storage.js');
assert(storage.includes("createObjectStore('vanillaFiles'"), 'vanilla IndexedDB store missing');
assert(storage.includes('saveVanillaLibrary') && storage.includes('loadVanillaLibrary'), 'vanilla library persistence missing');

console.log('UI static checks PASS');
