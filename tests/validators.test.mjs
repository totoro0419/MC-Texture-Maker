import assert from 'node:assert/strict';
import { validate, classify } from '../src/validators.js';
const enc=new TextEncoder();
const files=[{path:'pack.mcmeta',data:enc.encode('{"pack":{"pack_format":1}}'),directory:false},{path:'assets/minecraft/mcpatcher/sky/world0/sky1.properties',data:enc.encode('source=./missing.png\n'),directory:false}];
const p=validate(files); assert.equal(p.length,1); assert.match(p[0].message,/Missing sky source/); assert.equal(classify('assets/minecraft/textures/items/sword.png'),'Items'); console.log('validator PASS');
