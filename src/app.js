import { readZip, writeZip } from './zip.js';
import { classify, validate, counts } from './validators.js';
import { replaceProject, saveProjectMeta, saveFile, deleteFile as deleteStoredFile, loadProject, requestPersistentStorage, storageEstimate, getVanillaLibraryMeta, saveVanillaLibrary, loadVanillaLibrary } from './storage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IMAGE_TYPES = new Set(['Blocks','Items','Entities','GUI','Font','Particles','Painting','Environment','Armor','Textures','Sky','CTM','CIT','Lightmap']);

const state = {
  entries: [],
  meta: null,
  activePath: null,
  workspace: 'texture',
  problems: [],
  filter: 'All',
  search: '',
  objectUrls: new Map(),
  saveTimer: null,
  saving: false,
  pixel: {
    path: null,
    source: null,
    width: 0,
    height: 0,
    zoom: 1,
    grid: null,
    tool: 'pencil',
    color: '#f4b400',
    drawing: false,
    undo: [],
    redo: [],
    keyboardCell: { x: 0, y: 0 },
  },
  animation: { path: null, imagePath: null, timer: null, frame: 0, playing: false },
  vanilla: { meta: null, entries: [], loading: false },
};

const refs = {};
const REF_IDS = [
  'app','pack-file-input','png-file-input','new-project-button','new-project-hero','validate-button','export-button',
  'project-name','project-chip','save-state','save-label','status-ribbon','network-status','asset-search','asset-filter','asset-summary','asset-list',
  'png-import-label','project-empty-state','project-editor-surface','asset-kind','asset-title','asset-path','rename-button','delete-button',
  'problem-count','problems-button','problems-panel','close-problems','problems-list','error-count','warning-count','health-meter-bar','inspector-validate',
  'inspector-type','inspector-path','inspector-size','persist-storage','storage-summary','open-assets-drawer','close-assets-drawer','assets-panel',
  'open-inspector-drawer','close-inspector-drawer','inspector-panel','drawer-scrim','new-project-dialog','new-project-form','new-project-name',
  'new-project-description','new-project-optifine','new-project-source-vanilla','new-project-source-blank','vanilla-library-file','vanilla-library-label','vanilla-library-status','create-project-submit','confirm-dialog','confirm-title','confirm-message','confirm-accept','confirm-cancel','drop-overlay','toast-region',
  'texture-stage','texture-empty','canvas-scroll','canvas-frame','texture-canvas','canvas-keyboard-cursor','paint-color','grid-resolution','undo-button','redo-button',
  'zoom-out','zoom-in','zoom-output','texture-size','cursor-status','animation-canvas','animation-play','frame-strip','anim-frametime','anim-interpolate',
  'anim-frames','save-animation','model-canvas','model-json','format-model','save-model','sky-preview','sky-time','sky-time-output','sky-source',
  'sky-fade-in','sky-fade-out','sky-blend','sky-speed','sky-rotate','save-sky','raw-editor','raw-file-type','format-raw','save-raw','builder-title','builder-content'
];
for (const id of REF_IDS) refs[id] = document.getElementById(id);
refs.ctx = refs['texture-canvas'].getContext('2d', { willReadFrequently: true });
refs.animCtx = refs['animation-canvas'].getContext('2d');
refs.modelCtx = refs['model-canvas'].getContext('2d');

function basename(path = '') { return path.split('/').filter(Boolean).pop() || path; }
function ext(path = '') { const n = basename(path); return n.includes('.') ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : ''; }
function humanBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function projectEntryByPath(path) { return state.entries.find(e => e.path === path && !e.directory); }
function vanillaEntryByPath(path) { return state.vanilla.entries.find(e => e.path === path && !e.directory); }
function vanillaEnabled() { return !!state.meta?.useVanilla && !!state.vanilla.entries.length; }
function entryByPath(path) { return projectEntryByPath(path) || (vanillaEnabled() ? vanillaEntryByPath(path) : null); }
function visibleEntries() {
  if (!vanillaEnabled()) return state.entries;
  const overrides = new Set(state.entries.filter(e => !e.directory).map(e => e.path));
  return [...state.entries, ...state.vanilla.entries.filter(e => !e.directory && !overrides.has(e.path))];
}
function isVanillaBaseline(entry) { return !!entry?.baseline && !projectEntryByPath(entry.path); }
function ensureProjectEntry(path) {
  let entry = projectEntryByPath(path);
  if (entry) return entry;
  const base = vanillaEntryByPath(path);
  if (!base) return null;
  entry = { id: crypto.randomUUID(), path: base.path, data: base.data.slice(), directory: false, dirty: true, baseline: false };
  state.entries.push(entry);
  return entry;
}
function textOf(entry) { return decoder.decode(entry?.data || new Uint8Array()); }
function setText(entry, value) { entry.data = encoder.encode(value); entry.dirty = true; }
function isTextEntry(entry) { return !!entry && /\.(json|mcmeta|properties|txt|lang|fsh|vsh)$/i.test(entry.path); }
function isPng(entry) { return !!entry && /\.png$/i.test(entry.path); }
function projectReady() { return !!state.meta; }
function getMetaName() { return state.meta?.name || 'Resource Pack'; }

function setSaveState(kind, label) {
  refs['save-state'].dataset.state = kind;
  refs['save-label'].textContent = label;
}
function toast(message, kind = 'info', timeout = 3400) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden','true');
  icon.textContent = kind === 'error' ? '!' : kind === 'success' ? '✓' : '•';
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button'; close.setAttribute('aria-label','Dismiss notification'); close.textContent = '×';
  close.addEventListener('click', () => node.remove());
  node.append(icon, text, close);
  refs['toast-region'].append(node);
  if (timeout) window.setTimeout(() => node.remove(), timeout);
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeProjectFilename(name) {
  const base = (name || 'resource-pack').trim().replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').slice(0,80) || 'resource-pack';
  return `${base}.zip`;
}

function showModalWithFocusRestore(dialog) {
  const invoker = document.activeElement;
  const restore = () => {
    dialog.removeEventListener('close', restore);
    if (invoker?.isConnected) requestAnimationFrame(() => invoker.focus());
  };
  dialog.addEventListener('close', restore);
  dialog.showModal();
}

async function confirmAction(title, message, actionLabel = 'Continue') {
  refs['confirm-title'].textContent = title;
  refs['confirm-message'].textContent = message;
  refs['confirm-accept'].textContent = actionLabel;
  showModalWithFocusRestore(refs['confirm-dialog']);
  return new Promise(resolve => {
    const done = () => {
      refs['confirm-dialog'].removeEventListener('close', done);
      resolve(refs['confirm-dialog'].returnValue === 'confirm');
    };
    refs['confirm-dialog'].addEventListener('close', done);
  });
}

function setProjectUiReady(ready) {
  refs.app.dataset.project = ready ? 'ready' : 'empty';
  refs['project-empty-state'].classList.toggle('hidden', ready);
  refs['project-editor-surface'].classList.toggle('hidden', !ready);
  for (const node of [refs['validate-button'], refs['export-button'], refs['asset-search'], refs['asset-filter'], refs['png-file-input'], refs['inspector-validate']]) node.disabled = !ready;
  refs['png-import-label'].classList.toggle('disabled', !ready);
  refs['png-import-label'].setAttribute('aria-disabled', String(!ready));
  refs['project-name'].textContent = ready ? getMetaName() : 'No project';
  if (!ready) setSaveState('idle','Nothing to save');
}

function updateNetwork() {
  const online = navigator.onLine;
  refs['status-ribbon'].dataset.offline = String(!online);
  refs['network-status'].textContent = online ? 'Local-first editor · online' : 'Offline · local editing still available';
}

async function updateStorageSummary() {
  const est = await storageEstimate();
  if (!est?.quota) { refs['storage-summary'].textContent = 'Browser storage estimate is unavailable.'; return; }
  const pct = est.usage ? Math.min(100, est.usage / est.quota * 100) : 0;
  refs['storage-summary'].textContent = `${humanBytes(est.usage || 0)} used of ${humanBytes(est.quota)} (${pct.toFixed(0)}%).`;
}

function releaseObjectUrls() {
  for (const url of state.objectUrls.values()) URL.revokeObjectURL(url);
  state.objectUrls.clear();
}
function objectUrlFor(entry) {
  if (!entry) return '';
  if (!state.objectUrls.has(entry.path)) state.objectUrls.set(entry.path, URL.createObjectURL(new Blob([entry.data], { type: isPng(entry) ? 'image/png' : 'application/octet-stream' })));
  return state.objectUrls.get(entry.path);
}
function invalidateObjectUrl(path) {
  const url = state.objectUrls.get(path);
  if (url) URL.revokeObjectURL(url);
  state.objectUrls.delete(path);
}

function refreshFilterOptions() {
  const c = counts(visibleEntries());
  const previous = state.filter;
  refs['asset-filter'].replaceChildren(new Option('All assets','All'));
  for (const key of Object.keys(c).sort()) refs['asset-filter'].append(new Option(`${key} (${c[key]})`, key));
  refs['asset-filter'].value = [...refs['asset-filter'].options].some(o => o.value === previous) ? previous : 'All';
  state.filter = refs['asset-filter'].value;
}

function filteredEntries() {
  const q = state.search.trim().toLowerCase();
  return visibleEntries().filter(e => !e.directory)
    .filter(e => state.filter === 'All' || classify(e.path) === state.filter)
    .filter(e => !q || e.path.toLowerCase().includes(q))
    .sort((a,b) => {
      const ca = classify(a.path), cb = classify(b.path);
      return ca.localeCompare(cb) || a.path.localeCompare(b.path);
    });
}

function renderAssetList() {
  const list = filteredEntries();
  const allFiles = visibleEntries().filter(e => !e.directory);
  const textureCount = allFiles.filter(e => IMAGE_TYPES.has(classify(e.path))).length;
  refs['asset-summary'].innerHTML = `<span>${allFiles.length.toLocaleString()} files</span><span>${textureCount.toLocaleString()} textures</span>`;
  refs['asset-list'].replaceChildren();
  if (!projectReady()) {
    refs['asset-list'].innerHTML = '<div class="empty-mini"><div class="empty-mini-icon" aria-hidden="true">□</div><strong>No pack open</strong><span>Open a ZIP or create a project.</span></div>';
    return;
  }
  if (!list.length) {
    refs['asset-list'].innerHTML = '<div class="empty-mini"><div class="empty-mini-icon" aria-hidden="true">⌕</div><strong>No matching assets</strong><span>Clear the search or change the type filter.</span></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of list) {
    const type = classify(entry.path);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'asset-row';
    button.dataset.path = entry.path; button.setAttribute('aria-current', String(entry.path === state.activePath));
    const thumb = document.createElement('span'); thumb.className = 'asset-thumb'; thumb.setAttribute('aria-hidden','true');
    if (isPng(entry)) {
      const img = new Image(); img.src = objectUrlFor(entry); img.alt = ''; thumb.append(img);
    } else thumb.textContent = ext(entry.path).slice(0,4).toUpperCase() || 'FILE';
    const copy = document.createElement('span'); copy.className = 'asset-row-copy';
    const strong = document.createElement('strong'); strong.textContent = basename(entry.path);
    const path = document.createElement('span'); path.textContent = entry.path.replace(basename(entry.path),'').replace(/\/$/,'') || 'pack root';
    copy.append(strong,path);
    const badge = document.createElement('span'); badge.className = 'asset-row-type'; badge.textContent = isVanillaBaseline(entry) ? `${type} · Vanilla` : type;
    button.append(thumb,copy,badge);
    button.addEventListener('click', () => selectAsset(entry.path));
    fragment.append(button);
  }
  refs['asset-list'].append(fragment);
}

function updateAssetCurrentMarkers() {
  $$('.asset-row', refs['asset-list']).forEach(row => row.setAttribute('aria-current', String(row.dataset.path === state.activePath)));
}

function workspaceForEntry(entry) {
  if (!entry) return state.workspace;
  const type = classify(entry.path);
  if (isPng(entry)) return type === 'Sky' ? 'sky' : 'texture';
  if (/\.png\.mcmeta$/i.test(entry.path)) return 'animation';
  if (/\/models\/.+\.json$/i.test(entry.path)) return 'model';
  if (type === 'Sky' && /\.properties$/i.test(entry.path)) return 'sky';
  return 'advanced';
}

function switchWorkspace(name, focusTab = false) {
  state.workspace = name;
  for (const tab of $$('.workspace-tab')) {
    const selected = tab.dataset.workspace === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus();
  }
  for (const panel of $$('.workspace-panel')) panel.classList.toggle('hidden', panel.dataset.panel !== name);
  const entry = entryByPath(state.activePath);
  if (name === 'texture') loadTextureWorkspace(entry);
  if (name === 'animation') loadAnimationWorkspace(entry);
  if (name === 'model') loadModelWorkspace(entry);
  if (name === 'sky') loadSkyWorkspace(entry);
  if (name === 'advanced') loadAdvancedWorkspace(entry);
}

async function selectAsset(path, { autoWorkspace = true } = {}) {
  const entry = entryByPath(path);
  if (!entry) return;
  state.activePath = path;
  refs['asset-kind'].textContent = classify(entry.path);
  refs['asset-title'].textContent = basename(entry.path);
  refs['asset-path'].textContent = entry.path;
  const baseline = isVanillaBaseline(entry);
  refs['rename-button'].disabled = baseline;
  refs['delete-button'].disabled = baseline;
  refs['inspector-type'].textContent = classify(entry.path);
  refs['inspector-path'].textContent = entry.path;
  refs['inspector-size'].textContent = humanBytes(entry.data.byteLength);
  updateAssetCurrentMarkers();
  if (autoWorkspace) switchWorkspace(workspaceForEntry(entry));
  else switchWorkspace(state.workspace);
  closeDrawers();
}

function renderProject() {
  setProjectUiReady(projectReady());
  refreshFilterOptions();
  renderAssetList();
  updateProblems();
  if (projectReady()) {
    if (!entryByPath(state.activePath)) {
      const source = visibleEntries();
      const firstPng = source.find(e => !e.directory && isPng(e));
      const firstFile = source.find(e => !e.directory);
      const target = firstPng || firstFile;
      if (target) selectAsset(target.path);
      else clearSelection();
    } else selectAsset(state.activePath, { autoWorkspace: false });
  } else clearSelection();
  updateStorageSummary();
}

function clearSelection() {
  state.activePath = null;
  refs['asset-kind'].textContent = 'Asset'; refs['asset-title'].textContent = 'Choose an asset'; refs['asset-path'].textContent = 'Select a file from Assets to begin.';
  refs['rename-button'].disabled = true; refs['delete-button'].disabled = true;
  refs['inspector-type'].textContent = refs['inspector-path'].textContent = refs['inspector-size'].textContent = '—';
  loadTextureWorkspace(null); loadAnimationWorkspace(null); loadModelWorkspace(null); loadSkyWorkspace(null); loadAdvancedWorkspace(null);
}

function scheduleSave(entry = null) {
  clearTimeout(state.saveTimer);
  setSaveState('saving','Saving locally…');
  state.saveTimer = setTimeout(async () => {
    try {
      if (entry) await saveFile(entry.path, entry.data, true);
      if (state.meta) await saveProjectMeta(state.meta);
      setSaveState('saved','Saved locally');
      updateStorageSummary();
    } catch (error) {
      setSaveState('error','Save failed');
      toast(`Autosave failed: ${error.message}`, 'error', 0);
    }
  }, 250);
}

function isZipFile(file) {
  return !!file && (/\.zip$/i.test(file.name || '') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed');
}

function clearDragState() {
  document.body.classList.remove('is-dragging');
}

async function handleDroppedFiles(fileList) {
  clearDragState();
  const files = [...(fileList || [])];
  const zip = files.find(isZipFile);
  if (!zip) {
    toast('Drop a .zip Minecraft resource pack.', 'error');
    return;
  }
  await importPack(zip);
}

async function importPack(file) {
  if (!file) return;
  if (projectReady()) {
    const ok = await confirmAction('Replace current project?', 'Opening another ZIP replaces the local working project. Export the current pack first if you need a backup.', 'Open ZIP');
    if (!ok) { refs['pack-file-input'].value = ''; return; }
  }
  setSaveState('saving','Reading ZIP…');
  refs['pack-file-input'].disabled = true;
  try {
    const entries = await readZip(await file.arrayBuffer(), progress => setSaveState('saving',`Reading ZIP… ${Math.round(progress * 100)}%`));
    releaseObjectUrls();
    state.entries = entries;
    state.meta = { name: file.name.replace(/\.zip$/i,''), sourceName: file.name, createdAt: Date.now(), target: 'java-1.8.9' };
    state.activePath = null;
    state.problems = validate(entries);
    await replaceProject(entries, state.meta);
    setSaveState('saved','Imported and saved locally');
    renderProject();
    toast(`Opened ${file.name} · ${entries.filter(e=>!e.directory).length.toLocaleString()} files`, 'success');
  } catch (error) {
    setSaveState('error','Import failed');
    toast(error.message || 'Could not open this ZIP.', 'error', 0);
  } finally {
    refs['pack-file-input'].disabled = false;
    refs['pack-file-input'].value = '';
  }
}


function syncNewProjectSourceUi() {
  const wantsVanilla = refs['new-project-source-vanilla'].checked;
  const setup = document.getElementById('vanilla-library-setup');
  if (setup) setup.hidden = !wantsVanilla;
  const ready = !!state.vanilla.meta;
  refs['create-project-submit'].disabled = !!state.vanilla.loading || (wantsVanilla && !ready);
}

async function refreshVanillaLibraryStatus({ loadEntries = false } = {}) {
  try {
    const meta = await getVanillaLibraryMeta();
    state.vanilla.meta = meta;
    const setup = document.getElementById('vanilla-library-setup');
    if (setup) {
      setup.dataset.ready = String(!!meta);
      setup.dataset.loading = String(!!state.vanilla.loading);
    }
    refs['vanilla-library-status'].textContent = meta
      ? `Ready · ${Number(meta.count || 0).toLocaleString()} vanilla files cached locally from ${meta.sourceName || '1.8.9.jar'}.`
      : 'One-time setup: choose your local Minecraft 1.8.9 client JAR. It stays in this browser only.';
    refs['vanilla-library-label'].textContent = meta ? 'Replace 1.8.9.jar' : 'Choose 1.8.9.jar';
    if (loadEntries && meta) {
      const library = await loadVanillaLibrary();
      state.vanilla.entries = library?.entries || [];
      state.vanilla.meta = library?.meta || meta;
    }
  } catch (error) {
    state.vanilla.meta = null;
    refs['vanilla-library-status'].textContent = `Vanilla library unavailable: ${error.message}`;
  }
  syncNewProjectSourceUi();
}

function isVanillaTexturePath(path) {
  return /^assets\/minecraft\/textures\/.+\.(?:png|png\.mcmeta)$/i.test(path);
}

async function cacheVanillaLibraryFromJar(file) {
  if (!file) return;
  state.vanilla.loading = true;
  refs['vanilla-library-file'].disabled = true;
  refs['vanilla-library-label'].classList.add('disabled');
  refs['vanilla-library-status'].textContent = 'Reading 1.8.9 client JAR…';
  syncNewProjectSourceUi();
  try {
    const entries = await readZip(
      await file.arrayBuffer(),
      progress => { refs['vanilla-library-status'].textContent = `Reading 1.8.9 client JAR… ${Math.round(progress * 100)}%`; },
      isVanillaTexturePath,
    );
    const hasLegacyBlocks = entries.some(e => e.path === 'assets/minecraft/textures/blocks/stone.png');
    const hasLegacyItems = entries.some(e => e.path === 'assets/minecraft/textures/items/diamond_sword.png');
    const looksNewer = entries.some(e => /\/textures\/(?:block|item)\//i.test(e.path)) || entries.some(e => /(?:elytra|end_rod)/i.test(e.path));
    if (!hasLegacyBlocks || !hasLegacyItems || looksNewer) {
      throw new Error('This does not look like a Minecraft Java 1.8.9 client JAR. Choose .minecraft/versions/1.8.9/1.8.9.jar.');
    }
    if (entries.filter(e => /\.png$/i.test(e.path)).length < 200) {
      throw new Error('Too few vanilla textures were found in this JAR.');
    }
    const count = await saveVanillaLibrary(entries, { sourceName: file.name || '1.8.9.jar' });
    const library = await loadVanillaLibrary();
    state.vanilla.meta = library?.meta || { count, sourceName: file.name };
    state.vanilla.entries = library?.entries || [];
    refs['vanilla-library-status'].textContent = `Ready · ${count.toLocaleString()} vanilla files cached locally.`;
    toast(`Vanilla 1.8.9 library ready · ${count.toLocaleString()} files`, 'success');
  } catch (error) {
    refs['vanilla-library-status'].textContent = error.message || 'Could not read this JAR.';
    toast(error.message || 'Could not read the vanilla client JAR.', 'error', 0);
  } finally {
    state.vanilla.loading = false;
    refs['vanilla-library-file'].disabled = false;
    refs['vanilla-library-label'].classList.remove('disabled');
    refs['vanilla-library-file'].value = '';
    await refreshVanillaLibraryStatus();
  }
}

async function createNewProject() {
  const name = refs['new-project-name'].value.trim() || 'My Resource Pack';
  const description = refs['new-project-description'].value.trim() || 'Made with MC Texture Maker';
  const useVanilla = refs['new-project-source-vanilla'].checked;
  if (useVanilla && !state.vanilla.meta) {
    toast('Choose your local Minecraft 1.8.9 client JAR once before creating a vanilla-based pack.', 'error', 0);
    return false;
  }
  if (useVanilla && !state.vanilla.entries.length) {
    const library = await loadVanillaLibrary();
    state.vanilla.entries = library?.entries || [];
    state.vanilla.meta = library?.meta || state.vanilla.meta;
    if (!state.vanilla.entries.length) {
      toast('The local vanilla texture library is empty. Re-import 1.8.9.jar.', 'error', 0);
      return false;
    }
  }
  if (projectReady()) {
    const ok = await confirmAction('Replace current project?', 'Creating a new project replaces the local working project. Export the current pack first if you need a backup.', 'Create new');
    if (!ok) return false;
  }
  const mcmeta = { pack: { pack_format: 1, description } };
  const entries = [{ id: crypto.randomUUID(), path: 'pack.mcmeta', data: encoder.encode(JSON.stringify(mcmeta,null,2)), directory: false, dirty: true }];
  if (refs['new-project-optifine'].checked) {
    entries.push({ id: crypto.randomUUID(), path: 'assets/minecraft/mcpatcher/.keep', data: new Uint8Array(), directory: false, dirty: true });
  }
  releaseObjectUrls();
  state.entries = entries;
  state.meta = { name, createdAt: Date.now(), target: 'java-1.8.9', optifine: refs['new-project-optifine'].checked, useVanilla };
  state.activePath = useVanilla ? (state.vanilla.entries.find(e => /\/textures\/blocks\/stone\.png$/i.test(e.path))?.path || state.vanilla.entries.find(isPng)?.path || 'pack.mcmeta') : 'pack.mcmeta';
  state.problems = validate(entries);
  await replaceProject(entries, state.meta);
  setSaveState('saved','New project saved locally');
  renderProject();
  if (!useVanilla) switchWorkspace('advanced');
  toast(useVanilla ? `New 1.8.9 pack created with ${state.vanilla.entries.filter(isPng).length.toLocaleString()} vanilla textures available.` : 'New blank 1.8.9 resource pack created.', 'success');
  return true;
}

async function importPng(file) {
  if (!file || !projectReady()) return;
  let path = prompt('Resource-pack path for this PNG:', `assets/minecraft/textures/blocks/${file.name}`);
  if (!path) { refs['png-file-input'].value=''; return; }
  path = path.replace(/^\/+/, '').replace(/\\/g,'/');
  if (!/\.png$/i.test(path)) path += '.png';
  const existing = entryByPath(path);
  if (existing) {
    const baseline = isVanillaBaseline(existing);
    const ok = await confirmAction(baseline ? 'Override vanilla texture?' : 'Replace existing asset?', baseline ? `${path} is currently the vanilla 1.8.9 texture. Add this PNG as your project override?` : `${path} already exists. Replace its PNG bytes?`, baseline ? 'Add override' : 'Replace');
    if (!ok) { refs['png-file-input'].value=''; return; }
    const target = baseline ? ensureProjectEntry(path) : existing;
    target.data = new Uint8Array(await file.arrayBuffer()); target.dirty = true; invalidateObjectUrl(path); await saveFile(path, target.data, true);
  } else {
    const entry = { id: crypto.randomUUID(), path, data: new Uint8Array(await file.arrayBuffer()), directory:false, dirty:true };
    state.entries.push(entry); await saveFile(path, entry.data, true);
  }
  state.problems = validate(state.entries); renderProject(); await selectAsset(path); setSaveState('saved','PNG saved locally');
  refs['png-file-input'].value=''; toast(`Added ${basename(path)}`, 'success');
}

function runValidation({ openPanel = false } = {}) {
  if (!projectReady()) return;
  state.problems = validate(state.entries);
  updateProblems();
  if (openPanel || state.problems.length) setProblemsOpen(true);
  toast(state.problems.length ? `Validation found ${state.problems.length} problem${state.problems.length===1?'':'s'}.` : 'Validation passed with no detected problems.', state.problems.length ? 'info' : 'success');
}

function updateProblems() {
  const errors = state.problems.filter(p => p.severity === 'error').length;
  const warnings = state.problems.filter(p => p.severity === 'warning').length;
  refs['problem-count'].textContent = String(state.problems.length);
  refs['problem-count'].classList.toggle('has-problems', state.problems.length > 0);
  refs['error-count'].textContent = String(errors); refs['warning-count'].textContent = String(warnings);
  const health = state.problems.length ? Math.max(12, 100 - errors*18 - warnings*6) : 100;
  refs['health-meter-bar'].style.width = `${health}%`;
  refs['health-meter-bar'].style.background = errors ? 'var(--danger)' : warnings ? 'var(--warning)' : 'var(--success)';
  refs['problems-list'].replaceChildren();
  if (!projectReady()) {
    refs['problems-list'].innerHTML = '<div class="empty-mini"><strong>No project open</strong><span>Open a pack to run validation.</span></div>'; return;
  }
  if (!state.problems.length) {
    refs['problems-list'].innerHTML = '<div class="empty-mini"><strong>No detected problems</strong><span>The current validation rules did not find an issue.</span></div>'; return;
  }
  const frag = document.createDocumentFragment();
  for (const problem of state.problems) {
    const row = document.createElement('button'); row.type='button'; row.className=`problem-row ${problem.severity}`; row.style.width='100%'; row.style.borderLeft='0'; row.style.borderRight='0'; row.style.borderTop='0'; row.style.background='transparent'; row.style.textAlign='left'; row.style.cursor='pointer';
    const sev=document.createElement('span'); sev.className='problem-severity'; sev.textContent=problem.severity;
    const copy=document.createElement('span'); copy.className='problem-copy'; const strong=document.createElement('strong'); strong.textContent=problem.path; const msg=document.createElement('span'); msg.textContent=problem.message; copy.append(strong,msg); row.append(sev,copy);
    row.addEventListener('click',()=>{ if(entryByPath(problem.path)) selectAsset(problem.path); setProblemsOpen(false); }); frag.append(row);
  }
  refs['problems-list'].append(frag);
}

async function exportPack() {
  if (!projectReady()) return;
  runValidation();
  const errors = state.problems.filter(p => p.severity === 'error').length;
  if (errors) {
    const ok = await confirmAction('Export with validation errors?', `The validator found ${errors} error${errors===1?'':'s'}. Minecraft may reject or partially ignore this pack.`, 'Export anyway');
    if (!ok) return;
  }
  try {
    setSaveState('saving','Building ZIP…');
    const blob = writeZip(state.entries);
    downloadBlob(blob, safeProjectFilename(getMetaName()));
    setSaveState('saved','Export ready');
    toast('Minecraft-ready ZIP generated.', 'success');
  } catch (error) { setSaveState('error','Export failed'); toast(`Export failed: ${error.message}`, 'error', 0); }
}

async function renameActive() {
  const entry = entryByPath(state.activePath); if (!entry) return;
  const next = prompt('New resource-pack path:', entry.path); if (!next || next === entry.path) return;
  const clean = next.replace(/^\/+/, '').replace(/\\/g,'/');
  if (entryByPath(clean)) { toast('A file already exists at that path.', 'error'); return; }
  const old = entry.path; entry.path = clean; entry.dirty = true;
  await deleteStoredFile(old); await saveFile(clean, entry.data, true); invalidateObjectUrl(old); state.activePath = clean; state.problems = validate(state.entries); renderProject(); toast('Asset renamed.', 'success');
}

async function deleteActive() {
  const entry = entryByPath(state.activePath); if (!entry) return;
  const ok = await confirmAction('Delete asset?', `Delete ${entry.path} from this project? This can break references.`, 'Delete');
  if (!ok) return;
  await deleteStoredFile(entry.path); invalidateObjectUrl(entry.path); state.entries = state.entries.filter(e => e !== entry); state.activePath = null; state.problems = validate(state.entries); renderProject(); setSaveState('saved','Deletion saved locally');
}

function setProblemsOpen(open) {
  refs['problems-panel'].hidden = !open;
  refs['problems-button'].setAttribute('aria-expanded', String(open));
  if (open) refs['close-problems'].focus();
}

let drawerInvoker = null;
function setDrawerBackgroundInert(openPanel) {
  const targets = [$('.topbar'), $('.status-ribbon'), $('.workspace-nav'), $('.editor-column'), refs['assets-panel'], refs['inspector-panel'], refs['problems-panel'], refs['toast-region']].filter(Boolean);
  for (const target of targets) {
    if (target === openPanel) continue;
    target.inert = !!openPanel;
  }
}
function openDrawer(which) {
  const panel = which === 'assets' ? refs['assets-panel'] : refs['inspector-panel'];
  drawerInvoker = document.activeElement;
  closeDrawers(false);
  panel.classList.add('is-open');
  panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true'); panel.tabIndex = -1;
  refs['drawer-scrim'].hidden = false;
  (which === 'assets' ? refs['open-assets-drawer'] : refs['open-inspector-drawer']).setAttribute('aria-expanded','true');
  setDrawerBackgroundInert(panel);
  requestAnimationFrame(() => { const close = $('.panel-close', panel); (close || panel).focus(); });
}
function closeDrawers(restoreFocus = true) {
  const hadOpen = refs['assets-panel'].classList.contains('is-open') || refs['inspector-panel'].classList.contains('is-open');
  for (const panel of [refs['assets-panel'], refs['inspector-panel']]) { panel.classList.remove('is-open'); panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('tabindex'); }
  refs['drawer-scrim'].hidden = true; setDrawerBackgroundInert(null);
  refs['open-assets-drawer'].setAttribute('aria-expanded','false'); refs['open-inspector-drawer'].setAttribute('aria-expanded','false');
  if (hadOpen && restoreFocus && drawerInvoker?.isConnected) drawerInvoker.focus();
  drawerInvoker = null;
}

// ---------- Texture editor ----------
function availableGrids(width, height) {
  const presets = [16,32,64,128,256,512,1024];
  return presets.filter(n => n <= width && n <= height && width % n === 0 && height % n === 0);
}
function logicalGrid() {
  const p = state.pixel;
  if (!p.width || !p.height) return { cols: p.width || 1, rows: p.height || 1, cellW:1, cellH:1 };
  const cols = p.grid || p.width;
  const rows = p.grid ? Math.round(p.height / (p.width / p.grid)) : p.height;
  return { cols, rows, cellW: p.width / cols, cellH: p.height / rows };
}
function updateCanvasCss() {
  const p = state.pixel; if (!p.width) return;
  const base = Math.min(760 / p.width, 560 / p.height, 1);
  const displayScale = Math.max(.2, base * p.zoom);
  refs['texture-canvas'].style.width = `${Math.max(1, p.width * displayScale)}px`;
  refs['texture-canvas'].style.height = `${Math.max(1, p.height * displayScale)}px`;
  refs['zoom-output'].textContent = `${Math.round(p.zoom*100)}%`;
  updateKeyboardCursor();
}
function snapshotCanvas() {
  const { width, height } = state.pixel; if (!width || !height) return null;
  return refs.ctx.getImageData(0,0,width,height);
}
function pushUndo(snapshot) {
  if (!snapshot) return;
  state.pixel.undo.push(snapshot); if (state.pixel.undo.length > 12) state.pixel.undo.shift(); state.pixel.redo.length=0; updateUndoButtons();
}
function updateUndoButtons() { refs['undo-button'].disabled = !state.pixel.undo.length; refs['redo-button'].disabled = !state.pixel.redo.length; }
function restoreSnapshot(snapshot) { if (!snapshot) return; refs.ctx.putImageData(snapshot,0,0); markCanvasDirty(); }
function undoCanvas() { const current=snapshotCanvas(); const prior=state.pixel.undo.pop(); if(!prior)return; state.pixel.redo.push(current); restoreSnapshot(prior); updateUndoButtons(); }
function redoCanvas() { const current=snapshotCanvas(); const next=state.pixel.redo.pop(); if(!next)return; state.pixel.undo.push(current); restoreSnapshot(next); updateUndoButtons(); }
function rgbaFromHex(hex) { const n=parseInt(hex.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255,255]; }
function logicalCellAt(event) {
  const rect=refs['texture-canvas'].getBoundingClientRect(); const g=logicalGrid();
  const px=Math.max(0,Math.min(state.pixel.width-1,Math.floor((event.clientX-rect.left)/rect.width*state.pixel.width)));
  const py=Math.max(0,Math.min(state.pixel.height-1,Math.floor((event.clientY-rect.top)/rect.height*state.pixel.height)));
  return { x:Math.floor(px/g.cellW), y:Math.floor(py/g.cellH) };
}
function cellRect(cell) { const g=logicalGrid(); return { x:Math.floor(cell.x*g.cellW), y:Math.floor(cell.y*g.cellH), w:Math.ceil(g.cellW), h:Math.ceil(g.cellH) }; }
function applyCell(cell, tool = state.pixel.tool) {
  const r=cellRect(cell); const ctx=refs.ctx;
  if(tool==='eyedropper') {
    const d=ctx.getImageData(r.x,r.y,1,1).data; const hex=`#${[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('')}`; state.pixel.color=hex; refs['paint-color'].value=hex; toast(`Picked ${hex}`,'info',1200); return false;
  }
  if(tool==='fill') { floodFillLogical(cell); return true; }
  if(tool==='eraser') ctx.clearRect(r.x,r.y,r.w,r.h);
  else { const [rC,g,b,a]=rgbaFromHex(state.pixel.color); ctx.fillStyle=`rgba(${rC},${g},${b},${a/255})`; ctx.fillRect(r.x,r.y,r.w,r.h); }
  refs['cursor-status'].textContent=`Cell ${cell.x+1}, ${cell.y+1}`; return true;
}
function colorAtCell(cell) { const r=cellRect(cell); const d=refs.ctx.getImageData(r.x,r.y,1,1).data; return `${d[0]},${d[1]},${d[2]},${d[3]}`; }
function floodFillLogical(start) {
  const g=logicalGrid(); const target=colorAtCell(start); const replacement=state.pixel.tool==='eraser'?'0,0,0,0':rgbaFromHex(state.pixel.color).join(','); if(target===replacement)return;
  const queue=[start], seen=new Set();
  while(queue.length){const c=queue.pop(); const key=`${c.x},${c.y}`; if(seen.has(key)||c.x<0||c.y<0||c.x>=g.cols||c.y>=g.rows)continue; seen.add(key); if(colorAtCell(c)!==target)continue; const r=cellRect(c); if(state.pixel.tool==='eraser')refs.ctx.clearRect(r.x,r.y,r.w,r.h); else {const [rr,gg,bb,aa]=rgbaFromHex(state.pixel.color);refs.ctx.fillStyle=`rgba(${rr},${gg},${bb},${aa/255})`;refs.ctx.fillRect(r.x,r.y,r.w,r.h);} queue.push({x:c.x+1,y:c.y},{x:c.x-1,y:c.y},{x:c.x,y:c.y+1},{x:c.x,y:c.y-1});}
}
async function canvasToPngBytes() {
  const blob = await new Promise((resolve,reject)=>refs['texture-canvas'].toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function markCanvasDirty() {
  if (!entryByPath(state.pixel.path)) return;
  clearTimeout(state.pixel.encodeTimer);
  setSaveState('saving','Saving texture…');
  state.pixel.encodeTimer=setTimeout(async()=>{
    try {
      const entry = ensureProjectEntry(state.pixel.path) || projectEntryByPath(state.pixel.path);
      if (!entry) throw new Error('Could not create a project override for this texture.');
      entry.data=await canvasToPngBytes(); entry.dirty=true; invalidateObjectUrl(entry.path);
      await saveFile(entry.path,entry.data,true);
      setSaveState('saved','Saved locally'); refs['inspector-size'].textContent=humanBytes(entry.data.byteLength);
      refreshFilterOptions(); renderAssetList(); updateAssetCurrentMarkers();
    }
    catch(error){setSaveState('error','Texture save failed');toast(error.message,'error',0);}
  },220);
}
async function loadTextureWorkspace(entry) {
  const isImage=isPng(entry);
  refs['texture-empty'].classList.toggle('hidden',isImage);
  refs['canvas-scroll'].classList.toggle('hidden',!isImage);
  refs['grid-resolution'].disabled=!isImage;
  if(!isImage){state.pixel.path=null;refs['texture-size'].textContent='No texture selected';return;}
  if(state.pixel.path===entry.path && state.pixel.width) return;
  try {
    const bitmap=await createImageBitmap(new Blob([entry.data],{type:'image/png'}));
    state.pixel.path=entry.path;state.pixel.width=bitmap.width;state.pixel.height=bitmap.height;state.pixel.zoom=1;state.pixel.undo=[];state.pixel.redo=[];state.pixel.keyboardCell={x:0,y:0};
    refs['texture-canvas'].width=bitmap.width;refs['texture-canvas'].height=bitmap.height;refs.ctx.clearRect(0,0,bitmap.width,bitmap.height);refs.ctx.imageSmoothingEnabled=false;refs.ctx.drawImage(bitmap,0,0);bitmap.close();
    const grids=availableGrids(state.pixel.width,state.pixel.height);refs['grid-resolution'].replaceChildren(new Option('Native','native'));
    for(const g of grids) refs['grid-resolution'].append(new Option(`${g} logical px`,String(g)));
    state.pixel.grid = grids.includes(16) ? 16 : null; refs['grid-resolution'].value=state.pixel.grid?String(state.pixel.grid):'native';
    refs['texture-size'].textContent=`${state.pixel.width} × ${state.pixel.height} px`;updateCanvasCss();updateUndoButtons();updateKeyboardCursor();
  } catch(error) { refs['texture-empty'].classList.remove('hidden');refs['canvas-scroll'].classList.add('hidden');refs['texture-empty'].innerHTML='<div class="editor-empty-icon" aria-hidden="true">!</div><strong>PNG could not be decoded</strong><span>The original file is still preserved in the project.</span>';toast(`PNG decode failed: ${error.message}`,'error'); }
}
function setPixelTool(tool) {
  state.pixel.tool=tool;$$('.tool-button[data-tool]').forEach(btn=>{const active=btn.dataset.tool===tool;btn.classList.toggle('is-selected',active);btn.setAttribute('aria-pressed',String(active));});
}
function updateKeyboardCursor() {
  if(!state.pixel.width)return;const g=logicalGrid();const c=state.pixel.keyboardCell;c.x=Math.min(g.cols-1,Math.max(0,c.x));c.y=Math.min(g.rows-1,Math.max(0,c.y));const r=cellRect(c);const canvasRect=refs['texture-canvas'].getBoundingClientRect();const sx=canvasRect.width/state.pixel.width,sy=canvasRect.height/state.pixel.height;
  refs['canvas-keyboard-cursor'].style.left=`${r.x*sx}px`;refs['canvas-keyboard-cursor'].style.top=`${r.y*sy}px`;refs['canvas-keyboard-cursor'].style.width=`${r.w*sx}px`;refs['canvas-keyboard-cursor'].style.height=`${r.h*sy}px`;refs['cursor-status'].textContent=`Cell ${c.x+1}, ${c.y+1}`;
}

// ---------- Animation ----------
function animationMetaPathFor(entry) {
  if(!entry)return null;if(/\.png\.mcmeta$/i.test(entry.path))return entry.path;if(isPng(entry))return `${entry.path}.mcmeta`;return null;
}
function animationImagePath(metaPath) { return metaPath?.replace(/\.mcmeta$/i,'') || null; }
async function loadAnimationWorkspace(entry) {
  clearInterval(state.animation.timer);state.animation.playing=false;refs['animation-play'].textContent='Play';
  const metaPath=animationMetaPathFor(entry);const imagePath=metaPath?animationImagePath(metaPath):null;const imageEntry=entryByPath(imagePath);const metaEntry=entryByPath(metaPath);
  state.animation.path=metaPath;state.animation.imagePath=imageEntry?imagePath:null;refs['save-animation'].disabled=!metaPath||!imageEntry;
  let cfg={animation:{frametime:1,interpolate:false}};if(metaEntry){try{cfg=JSON.parse(textOf(metaEntry));}catch{}}
  refs['anim-frametime'].value=String(cfg?.animation?.frametime||1);refs['anim-interpolate'].checked=!!cfg?.animation?.interpolate;refs['anim-frames'].value=Array.isArray(cfg?.animation?.frames)?cfg.animation.frames.map(f=>typeof f==='number'?f:f.index).join(', '):'';
  refs['frame-strip'].replaceChildren();const canvas=refs['animation-canvas'];const ctx=refs.animCtx;ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!imageEntry){canvas.width=256;canvas.height=256;ctx.fillStyle='#f2f3f5';ctx.fillRect(0,0,256,256);ctx.fillStyle='#66717e';ctx.font='14px system-ui';ctx.textAlign='center';ctx.fillText('Select an animated PNG',128,128);return;}
  try{const bitmap=await createImageBitmap(new Blob([imageEntry.data],{type:'image/png'}));const fw=bitmap.width;const fh=bitmap.width;const total=Math.max(1,Math.floor(bitmap.height/fh));canvas.width=fw;canvas.height=fh;state.animation.bitmap?.close?.();state.animation.bitmap=bitmap;state.animation.total=total;state.animation.frame=0;for(let i=0;i<total;i++){const chip=document.createElement('span');chip.className=`frame-chip${i===0?' is-active':''}`;chip.textContent=String(i);refs['frame-strip'].append(chip);}drawAnimationFrame(0);}catch(error){toast(`Animation preview failed: ${error.message}`,'error');}
}
function drawAnimationFrame(index){const a=state.animation;if(!a.bitmap)return;const i=((index%a.total)+a.total)%a.total;a.frame=i;refs.animCtx.clearRect(0,0,refs['animation-canvas'].width,refs['animation-canvas'].height);refs.animCtx.imageSmoothingEnabled=false;refs.animCtx.drawImage(a.bitmap,0,i*a.bitmap.width,a.bitmap.width,a.bitmap.width,0,0,refs['animation-canvas'].width,refs['animation-canvas'].height);$$('.frame-chip',refs['frame-strip']).forEach((n,j)=>n.classList.toggle('is-active',j===i));}
function toggleAnimation(){if(!state.animation.bitmap)return;state.animation.playing=!state.animation.playing;refs['animation-play'].textContent=state.animation.playing?'Pause':'Play';clearInterval(state.animation.timer);if(state.animation.playing){const ms=Math.max(50,Number(refs['anim-frametime'].value||1)*50);state.animation.timer=setInterval(()=>drawAnimationFrame(state.animation.frame+1),ms);}}
async function saveAnimation(){const path=state.animation.path,image=entryByPath(state.animation.imagePath);if(!path||!image)return;const frames=refs['anim-frames'].value.split(',').map(s=>s.trim()).filter(Boolean).map(Number).filter(Number.isInteger);const animation={frametime:Math.max(1,Math.floor(Number(refs['anim-frametime'].value)||1))};if(refs['anim-interpolate'].checked)animation.interpolate=true;if(frames.length)animation.frames=frames;let entry=projectEntryByPath(path)||ensureProjectEntry(path);if(!entry){entry={id:crypto.randomUUID(),path,data:new Uint8Array(),directory:false,dirty:true};state.entries.push(entry);}setText(entry,JSON.stringify({animation},null,2));await saveFile(path,entry.data,true);state.problems=validate(state.entries);refreshFilterOptions();renderAssetList();updateProblems();setSaveState('saved','Animation metadata saved');toast(`Saved ${basename(path)}`,'success');}

// ---------- Model ----------
async function loadModelWorkspace(entry){const usable=!!entry&&/\/models\/.+\.json$/i.test(entry.path);refs['model-json'].disabled=!usable;refs['format-model'].disabled=!usable;refs['save-model'].disabled=!usable;refs['model-json'].value=usable?textOf(entry):'';drawModelPreview(usable?refs['model-json'].value:null);}
function drawModelPreview(source){const c=refs['model-canvas'],ctx=refs.modelCtx;const ratio=Math.max(1,window.devicePixelRatio||1);const w=Math.max(320,c.clientWidth||520),h=380;c.width=w*ratio;c.height=h*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#f7f8fa';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#e1e4e8';for(let x=0;x<w;x+=24){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  let model;try{model=source?JSON.parse(source):null;}catch{model=null;}const elements=Array.isArray(model?.elements)?model.elements:[];if(!elements.length){ctx.fillStyle='#66717e';ctx.font='14px system-ui';ctx.textAlign='center';ctx.fillText(source?'No drawable elements':'Select a model JSON file',w/2,h/2);return;}
  const project=(x,y,z)=>({x:w/2+(x-z)*7.2,y:h*0.72-(y*8.2)+(x+z)*3.6});const face=(pts,fill)=>{ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle='rgba(74,57,0,.22)';ctx.stroke();};
  for(const el of elements.slice(0,64)){const f=el.from||[0,0,0],t=el.to||[16,16,16];const p000=project(f[0],f[1],f[2]),p100=project(t[0],f[1],f[2]),p001=project(f[0],f[1],t[2]),p101=project(t[0],f[1],t[2]),p010=project(f[0],t[1],f[2]),p110=project(t[0],t[1],f[2]),p011=project(f[0],t[1],t[2]),p111=project(t[0],t[1],t[2]);face([p010,p110,p111,p011],'#ffe27a');face([p100,p101,p111,p110],'#f4b400');face([p001,p101,p111,p011],'#ffd34a');}
}
async function saveModel(){const entry=entryByPath(state.activePath);if(!entry)return;try{const parsed=JSON.parse(refs['model-json'].value);setText(entry,JSON.stringify(parsed,null,2));await saveFile(entry.path,entry.data,true);state.problems=validate(state.entries);updateProblems();drawModelPreview(refs['model-json'].value);setSaveState('saved','Model saved locally');toast('Model JSON saved.','success');}catch(error){toast(`Invalid JSON: ${error.message}`,'error',0);}}

// ---------- Sky ----------
function parseProperties(text){const out={};for(const line of text.split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i>0)out[t.slice(0,i).trim()]=t.slice(i+1).trim();}return out;}
function serializeProperties(obj){return Object.entries(obj).filter(([,v])=>v!==''&&v!==undefined&&v!==null).map(([k,v])=>`${k}=${v}`).join('\n')+'\n';}
function skyPropertyEntry(entry){if(!entry)return null;if(/mcpatcher\/sky\/.+\.properties$/i.test(entry.path))return entry;if(isPng(entry)&&/mcpatcher\/sky\//i.test(entry.path))return entryByPath(entry.path.replace(/\.png$/i,'.properties'));return null;}
async function loadSkyWorkspace(entry){const prop=skyPropertyEntry(entry);const cfg=prop?parseProperties(textOf(prop)):{};refs['sky-source'].value=cfg.source||'';refs['sky-fade-in'].value=cfg.startFadeIn||'';refs['sky-fade-out'].value=cfg.endFadeOut||'';refs['sky-blend'].value=['add','alpha','screen','multiply','replace'].includes(cfg.blend)?cfg.blend:'add';refs['sky-speed'].value=cfg.speed||'1';refs['sky-rotate'].checked=(cfg.rotate??'true')!=='false';refs['save-sky'].disabled=!prop;state.skyPropPath=prop?.path||null;await updateSkyPreview(prop,cfg);}
async function updateSkyPreview(prop,cfg){let img=null;if(prop&&cfg?.source){let target=cfg.source;if(target.startsWith('./')){target=prop.path.slice(0,prop.path.lastIndexOf('/')+1)+target.slice(2);}img=entryByPath(target);}refs['sky-preview'].style.setProperty('--sky-image',img?`url("${objectUrlFor(img)}")`:'none');updateSkyTime();}
function updateSkyTime(){const t=Number(refs['sky-time'].value);const hour=(t/1000+6)%24;const h=Math.floor(hour),m=Math.floor((hour-h)*60);refs['sky-time-output'].textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;const daylight=Math.max(0,Math.sin((hour-6)/12*Math.PI));const dark=1-daylight;const top=dark>.65?'#1c2857':dark>.25?'#7b85bd':'#72b9ff';const bottom=dark>.65?'#5b487b':dark>.25?'#f7b37d':'#fff5c9';refs['sky-preview'].style.background=`linear-gradient(${top},${bottom})`;}
async function saveSky(){const entry=entryByPath(state.skyPropPath);if(!entry)return;const existing=parseProperties(textOf(entry));const cfg={...existing,source:refs['sky-source'].value.trim(),startFadeIn:refs['sky-fade-in'].value.trim(),endFadeOut:refs['sky-fade-out'].value.trim(),blend:refs['sky-blend'].value,rotate:String(refs['sky-rotate'].checked),speed:String(refs['sky-speed'].value||1)};setText(entry,serializeProperties(cfg));await saveFile(entry.path,entry.data,true);state.problems=validate(state.entries);updateProblems();await updateSkyPreview(entry,cfg);setSaveState('saved','Sky properties saved');toast('Sky layer properties saved.','success');}

// ---------- Advanced ----------
function loadAdvancedWorkspace(entry){const usable=isTextEntry(entry);refs['raw-editor'].disabled=!usable;refs['save-raw'].disabled=!usable;refs['format-raw'].disabled=!usable||!(/\.(json|mcmeta)$/i.test(entry?.path||''));refs['raw-editor'].value=usable?textOf(entry):'';refs['raw-file-type'].textContent=entry?ext(entry.path).toUpperCase()||'File':'Text';renderBuilder(entry);}
function renderBuilder(entry){refs['builder-content'].replaceChildren();const type=entry?classify(entry.path):null;if(!entry||!['CTM','CIT'].includes(type)||!/\.properties$/i.test(entry.path)){refs['builder-title'].textContent='Properties helper';refs['builder-content'].innerHTML='<p class="muted">Select a CTM or CIT properties file to get structured fields.</p>';return;}const cfg=parseProperties(textOf(entry));refs['builder-title'].textContent=type==='CTM'?'CTM builder':'CIT builder';const wrap=document.createElement('div');wrap.className='builder-grid';const fields=type==='CTM'?[['method','Method','ctm'],['matchBlocks','Match blocks',''],['tiles','Tiles','0-46']]:[['type','Type','item'],['items','Items',''],['texture','Texture','']];for(const [key,label,ph] of fields){const lab=document.createElement('label');lab.className='field';const span=document.createElement('span');span.textContent=label;const input=document.createElement('input');input.type='text';input.value=cfg[key]||'';input.placeholder=ph;input.dataset.builderKey=key;lab.append(span,input);wrap.append(lab);}const apply=document.createElement('button');apply.type='button';apply.className='button secondary full-width';apply.textContent='Apply fields to editor';apply.addEventListener('click',()=>{const next={...parseProperties(refs['raw-editor'].value)};for(const input of $$('[data-builder-key]',wrap))next[input.dataset.builderKey]=input.value.trim();refs['raw-editor'].value=serializeProperties(next);refs['raw-editor'].focus();});wrap.append(apply);refs['builder-content'].append(wrap);}
async function saveRaw(){let entry=entryByPath(state.activePath);if(!entry||!isTextEntry(entry))return;if(isVanillaBaseline(entry))entry=ensureProjectEntry(entry.path);if(!entry)return;if(/\.(json|mcmeta)$/i.test(entry.path)){try{JSON.parse(refs['raw-editor'].value);}catch(error){toast(`Invalid JSON: ${error.message}`,'error',0);return;}}setText(entry,refs['raw-editor'].value);await saveFile(entry.path,entry.data,true);state.problems=validate(state.entries);updateProblems();setSaveState('saved','File saved locally');renderBuilder(entry);toast('File saved.','success');}
function formatJsonTextarea(textarea){try{textarea.value=JSON.stringify(JSON.parse(textarea.value),null,2);}catch(error){toast(`Invalid JSON: ${error.message}`,'error');}}

// ---------- Events ----------
refs['pack-file-input'].addEventListener('change',e=>importPack(e.target.files?.[0]));
refs['png-file-input'].addEventListener('change',e=>importPng(e.target.files?.[0]));
const openNewProjectDialog = async () => { await refreshVanillaLibraryStatus(); showModalWithFocusRestore(refs['new-project-dialog']); };
refs['new-project-button'].addEventListener('click',openNewProjectDialog);
refs['new-project-hero'].addEventListener('click',openNewProjectDialog);
refs['new-project-source-vanilla'].addEventListener('change',syncNewProjectSourceUi);
refs['new-project-source-blank'].addEventListener('change',syncNewProjectSourceUi);
refs['vanilla-library-file'].addEventListener('change',e=>cacheVanillaLibraryFromJar(e.target.files?.[0]));
refs['new-project-form'].addEventListener('submit',async e=>{if(e.submitter?.value!=='default')return;e.preventDefault();try{if(await createNewProject())refs['new-project-dialog'].close('created');}catch(error){toast(error.message,'error',0);}});
refs['validate-button'].addEventListener('click',()=>runValidation({openPanel:true}));refs['inspector-validate'].addEventListener('click',()=>runValidation({openPanel:true}));refs['export-button'].addEventListener('click',exportPack);
refs['asset-search'].addEventListener('input',e=>{state.search=e.target.value;renderAssetList();});refs['asset-filter'].addEventListener('change',e=>{state.filter=e.target.value;renderAssetList();});
refs['rename-button'].addEventListener('click',renameActive);refs['delete-button'].addEventListener('click',deleteActive);
refs['problems-button'].addEventListener('click',()=>setProblemsOpen(refs['problems-panel'].hidden));refs['close-problems'].addEventListener('click',()=>setProblemsOpen(false));
refs['persist-storage'].addEventListener('click',async()=>{const ok=await requestPersistentStorage();toast(ok?'Persistent browser storage granted.':'Persistent storage was not granted; autosave still works within browser quota.',ok?'success':'info');updateStorageSummary();});
refs['open-assets-drawer'].addEventListener('click',()=>openDrawer('assets'));refs['close-assets-drawer'].addEventListener('click',closeDrawers);refs['open-inspector-drawer'].addEventListener('click',()=>openDrawer('inspector'));refs['close-inspector-drawer'].addEventListener('click',closeDrawers);refs['drawer-scrim'].addEventListener('click',closeDrawers);

for(const tab of $$('.workspace-tab')){tab.addEventListener('click',()=>switchWorkspace(tab.dataset.workspace));tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=$$('.workspace-tab');let i=tabs.indexOf(tab);if(e.key==='ArrowLeft')i=(i-1+tabs.length)%tabs.length;if(e.key==='ArrowRight')i=(i+1)%tabs.length;if(e.key==='Home')i=0;if(e.key==='End')i=tabs.length-1;switchWorkspace(tabs[i].dataset.workspace,true);});}
for(const btn of $$('.tool-button[data-tool]'))btn.addEventListener('click',()=>setPixelTool(btn.dataset.tool));
refs['paint-color'].addEventListener('input',e=>state.pixel.color=e.target.value);refs['grid-resolution'].addEventListener('change',e=>{state.pixel.grid=e.target.value==='native'?null:Number(e.target.value);state.pixel.keyboardCell={x:0,y:0};updateKeyboardCursor();});
refs['undo-button'].addEventListener('click',undoCanvas);refs['redo-button'].addEventListener('click',redoCanvas);refs['zoom-out'].addEventListener('click',()=>{state.pixel.zoom=Math.max(.25,state.pixel.zoom/1.25);updateCanvasCss();});refs['zoom-in'].addEventListener('click',()=>{state.pixel.zoom=Math.min(16,state.pixel.zoom*1.25);updateCanvasCss();});
refs['texture-canvas'].addEventListener('pointerdown',e=>{if(!state.pixel.path)return;e.preventDefault();refs['texture-canvas'].setPointerCapture(e.pointerId);pushUndo(snapshotCanvas());state.pixel.drawing=true;const cell=logicalCellAt(e);state.pixel.keyboardCell=cell;if(applyCell(cell)){markCanvasDirty();}updateKeyboardCursor();});
refs['texture-canvas'].addEventListener('pointermove',e=>{if(!state.pixel.drawing||!['pencil','eraser'].includes(state.pixel.tool))return;const cell=logicalCellAt(e);state.pixel.keyboardCell=cell;applyCell(cell);markCanvasDirty();updateKeyboardCursor();});
refs['texture-canvas'].addEventListener('pointerup',()=>state.pixel.drawing=false);refs['texture-canvas'].addEventListener('pointercancel',()=>state.pixel.drawing=false);
refs['texture-canvas'].addEventListener('keydown',e=>{const g=logicalGrid(),c=state.pixel.keyboardCell;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')c.x=Math.max(0,c.x-1);if(e.key==='ArrowRight')c.x=Math.min(g.cols-1,c.x+1);if(e.key==='ArrowUp')c.y=Math.max(0,c.y-1);if(e.key==='ArrowDown')c.y=Math.min(g.rows-1,c.y+1);updateKeyboardCursor();}if(e.key==='Enter'||e.key===' '){e.preventDefault();pushUndo(snapshotCanvas());if(applyCell(c))markCanvasDirty();}});
refs['animation-play'].addEventListener('click',toggleAnimation);refs['save-animation'].addEventListener('click',saveAnimation);
refs['model-json'].addEventListener('input',()=>{clearTimeout(state.modelPreviewTimer);state.modelPreviewTimer=setTimeout(()=>drawModelPreview(refs['model-json'].value),180);});refs['format-model'].addEventListener('click',()=>{formatJsonTextarea(refs['model-json']);drawModelPreview(refs['model-json'].value);});refs['save-model'].addEventListener('click',saveModel);
refs['sky-time'].addEventListener('input',updateSkyTime);refs['save-sky'].addEventListener('click',saveSky);
refs['format-raw'].addEventListener('click',()=>formatJsonTextarea(refs['raw-editor']));refs['save-raw'].addEventListener('click',saveRaw);
let dragDepth = 0;
document.addEventListener('dragenter', e => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth += 1;
  document.body.classList.add('is-dragging');
});
document.addEventListener('dragover', e => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', e => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) clearDragState();
});
document.addEventListener('drop', e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  handleDroppedFiles(e.dataTransfer.files);
});
window.addEventListener('blur', () => { dragDepth = 0; clearDragState(); });
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);window.addEventListener('resize',()=>{updateCanvasCss();if(state.workspace==='model')drawModelPreview(refs['model-json'].value);});
document.addEventListener('keydown',e=>{
  const editable=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if(e.key==='Escape'){closeDrawers();if(!refs['problems-panel'].hidden)setProblemsOpen(false);return;}
  if(editable)return;
  if(e.key==='/'){e.preventDefault();refs['asset-search'].focus();return;}
  const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoCanvas():undoCanvas();return;}if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();redoCanvas();return;}
  if(state.workspace==='texture'){const map={b:'pencil',e:'eraser',g:'fill',i:'eyedropper'};if(map[e.key.toLowerCase()])setPixelTool(map[e.key.toLowerCase()]);}
});

async function boot() {
  updateNetwork(); setProjectUiReady(false); setSaveState('saving','Checking local project…');
  await refreshVanillaLibraryStatus();
  try {
    const saved=await loadProject();
    if(saved){
      state.entries=saved.entries; state.meta=saved.meta;
      if (state.meta?.useVanilla && state.vanilla.meta) {
        const library = await loadVanillaLibrary();
        state.vanilla.entries = library?.entries || [];
        state.vanilla.meta = library?.meta || state.vanilla.meta;
      }
      state.problems=validate(state.entries);setSaveState('saved','Restored local project');renderProject();toast(`Restored ${getMetaName()} from local storage.`,'success',2400);
      if (state.meta?.useVanilla && !state.vanilla.entries.length) toast('This project uses the vanilla 1.8.9 library. Re-import 1.8.9.jar to restore the baseline textures.', 'info', 0);
    }
    else {setSaveState('idle','Nothing to save');renderProject();}
  } catch(error){setSaveState('error','Recovery failed');toast(`Could not restore local project: ${error.message}`,'error',0);renderProject();}
  updateStorageSummary();
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js');}catch(error){console.warn('Service worker registration failed',error);}}
}

boot();
