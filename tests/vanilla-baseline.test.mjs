import assert from 'node:assert/strict';
import { readZip, writeZip } from '../src/zip.js';

if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

const entries = [
  { path: 'assets/minecraft/textures/blocks/stone.png', data: new Uint8Array([1,2,3]), directory: false },
  { path: 'assets/minecraft/textures/items/diamond_sword.png', data: new Uint8Array([4,5,6]), directory: false },
  { path: 'com/example/Class.class', data: new Uint8Array([7,8,9]), directory: false },
];
const blob = writeZip(entries);
const bytes = new Uint8Array(await blob.arrayBuffer());
const filtered = await readZip(bytes, () => {}, name => /^assets\/minecraft\/textures\//.test(name));
assert.deepEqual(filtered.map(e => e.path).sort(), [
  'assets/minecraft/textures/blocks/stone.png',
  'assets/minecraft/textures/items/diamond_sword.png',
]);
console.log('vanilla baseline ZIP filter PASS');
