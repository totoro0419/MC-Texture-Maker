const decoder = new TextDecoder();

export function classify(path) {
  const p = path.toLowerCase();
  if (p.endsWith('.png')) {
    if (p.includes('/mcpatcher/sky/')) return 'Sky';
    if (p.includes('/mcpatcher/ctm/')) return 'CTM';
    if (p.includes('/mcpatcher/cit/')) return 'CIT';
    if (p.includes('/textures/blocks/')) return 'Blocks';
    if (p.includes('/textures/items/')) return 'Items';
    if (p.includes('/textures/entity/')) return 'Entities';
    if (p.includes('/textures/gui/')) return 'GUI';
    if (p.includes('/textures/font/') || p.includes('/mcpatcher/font/')) return 'Font';
    if (p.includes('/textures/particle')) return 'Particles';
    if (p.includes('/textures/painting')) return 'Painting';
    if (p.includes('/textures/environment/')) return 'Environment';
    if (p.includes('/textures/models/armor/')) return 'Armor';
    if (p.includes('/mcpatcher/lightmap/')) return 'Lightmap';
    return 'Textures';
  }
  if (p.endsWith('.json')) return p.includes('/models/') ? 'Models' : 'JSON';
  if (p.endsWith('.mcmeta')) return 'Animation';
  if (p.endsWith('.properties')) {
    if (p.includes('/sky/')) return 'Sky';
    if (p.includes('/ctm/')) return 'CTM';
    if (p.includes('/cit/')) return 'CIT';
    return 'Properties';
  }
  if (p.endsWith('.ogg')) return 'Audio';
  return 'Other';
}

function text(entry) { return decoder.decode(entry.data); }
function resolveRelative(basePath, rel) {
  if (!rel.startsWith('./')) return rel.replace(/^\/+/, '');
  const dir = basePath.slice(0, basePath.lastIndexOf('/') + 1);
  const parts = (dir + rel.slice(2)).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

export function validate(entries) {
  const files = new Map(entries.filter(e => !e.directory).map(e => [e.path, e]));
  const problems = [];
  const pack = files.get('pack.mcmeta');
  if (!pack) problems.push({ severity: 'error', path: 'pack.mcmeta', message: 'pack.mcmeta is missing.' });
  else {
    try {
      const parsed = JSON.parse(text(pack));
      if (parsed?.pack?.pack_format !== 1) problems.push({ severity: 'error', path: 'pack.mcmeta', message: 'Java 1.8.9 requires pack_format: 1.' });
    } catch { problems.push({ severity: 'error', path: 'pack.mcmeta', message: 'pack.mcmeta is not valid JSON.' }); }
  }

  const lower = new Map();
  for (const entry of files.values()) {
    const key = entry.path.toLowerCase();
    if (lower.has(key) && lower.get(key) !== entry.path) problems.push({ severity: 'warning', path: entry.path, message: `Case-insensitive collision with ${lower.get(key)}.` });
    lower.set(key, entry.path);
    if (/\.(json|mcmeta)$/i.test(entry.path)) {
      try { JSON.parse(text(entry)); } catch { problems.push({ severity: 'error', path: entry.path, message: 'Invalid JSON.' }); }
    }
    if (/mcpatcher\/sky\/.*\.properties$/i.test(entry.path)) {
      const source = text(entry).split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('source='))?.slice(7).trim();
      if (source) {
        const target = resolveRelative(entry.path, source);
        if (!files.has(target)) problems.push({ severity: 'error', path: entry.path, message: `Missing sky source: ${target}` });
      }
    }
    if (/\.png\.mcmeta$/i.test(entry.path)) {
      try {
        const cfg = JSON.parse(text(entry));
        const ft = cfg?.animation?.frametime;
        if (ft !== undefined && (!Number.isInteger(ft) || ft < 1)) problems.push({ severity: 'warning', path: entry.path, message: 'frametime should be a positive integer.' });
      } catch {}
    }
  }
  return problems;
}

export function counts(entries) {
  const out = {};
  for (const e of entries) {
    if (e.directory) continue;
    const c = classify(e.path);
    out[c] = (out[c] || 0) + 1;
  }
  return out;
}
