import assert from 'node:assert/strict';
import { writeZip, readZip, crc32 } from '../src/zip.js';
const enc = new TextEncoder(), dec = new TextDecoder();
const entries = [
  {path:'pack.mcmeta',data:enc.encode('{"pack":{"pack_format":1}}'),directory:false},
  {path:'assets/minecraft/test.txt',data:enc.encode('hello world'),directory:false},
  {path:'assets/minecraft/日本語.txt',data:enc.encode('ok'),directory:false}
];
const blob = writeZip(entries);
const round = await readZip(await blob.arrayBuffer());
assert.equal(round.length, 3);
const map = new Map(round.map(e=>[e.path,dec.decode(e.data)]));
assert.equal(map.get('assets/minecraft/test.txt'),'hello world');
assert.equal(map.get('assets/minecraft/日本語.txt'),'ok');
assert.equal(crc32(enc.encode('123456789')),0xcbf43926);
console.log('zip round-trip PASS');
