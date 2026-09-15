const decoder = new TextDecoder();
const encoder = new TextEncoder();

function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }

export class ModelStudio {
  constructor(root, api) { this.root = root; this.api = api; this.elements = []; this.selected = -1; this.build(); }
  build() {
    this.root.innerHTML = `
      <section class="studio-layout model-layout">
        <div class="studio-main">
          <div class="studio-title"><div><span class="eyebrow">JAVA 1.8.9 MODEL JSON</span><h2>3D Model Studio</h2></div><div><button id="addCube" class="secondary">+ Cube</button><button id="saveModel" class="primary">Save model</button></div></div>
          <div class="model-stage"><canvas id="modelCanvas" width="760" height="560"></canvas><div class="view-label">Isometric preview · 0–16 model space</div></div>
          <div id="elementList" class="element-list"></div>
        </div>
        <aside class="inspector model-inspector">
          <div class="inspector-head"><span>Model</span><span class="badge">1.8.9</span></div>
          <label>Model file<select id="modelFile"></select></label>
          <label>New / save path<input id="modelPath" value="assets/minecraft/models/item/custom_item.json"></label>
          <label>Parent<input id="modelParent" value="builtin/generated"></label>
          <label>Texture #layer0<input id="modelTexture" value="items/diamond_sword"></label>
          <div class="inspector-head compact"><span>Selected cuboid</span></div>
          <div class="vector-label">From</div><div class="vector"><input id="fx" type="number"><input id="fy" type="number"><input id="fz" type="number"></div>
          <div class="vector-label">To</div><div class="vector"><input id="tx" type="number"><input id="ty" type="number"><input id="tz" type="number"></div>
          <button id="applyCube" class="secondary full">Apply cuboid values</button>
          <div class="hint">The visual editor generates legacy 1.8.9 JSON. For advanced face UV/rotation fields, use Advanced → Raw editor.</div>
        </aside>
      </section>`;
    this.canvas = this.root.querySelector('#modelCanvas'); this.ctx = this.canvas.getContext('2d');
    this.root.querySelector('#modelFile').onchange = e => this.load(e.target.value);
    this.root.querySelector('#addCube').onclick = () => { this.elements.push({ from: [0, 0, 0], to: [16, 16, 16], faces: this.defaultFaces() }); this.selected = this.elements.length - 1; this.render(); this.syncSelected(); };
    this.root.querySelector('#applyCube').onclick = () => this.applyCube();
    this.root.querySelector('#saveModel').onclick = () => this.save();
  }
  defaultFaces() { return Object.fromEntries(['down','up','north','south','west','east'].map(f => [f, { texture: '#layer0' }])); }
  refreshList() {
    const models = this.api.entries().filter(e => /assets\/minecraft\/models\/.*\.json$/i.test(e.path));
    const sel = this.root.querySelector('#modelFile');
    sel.innerHTML = `<option value="">New model…</option>` + models.map(e => `<option value="${e.path}">${e.path}</option>`).join('');
  }
  load(path) {
    if (!path) return;
    const e = this.api.getFile(path); if (!e) return;
    try {
      const j = JSON.parse(decoder.decode(e.data));
      this.root.querySelector('#modelPath').value = path;
      this.root.querySelector('#modelParent').value = j.parent || '';
      this.root.querySelector('#modelTexture').value = j.textures?.layer0 || j.textures?.particle || '';
      this.elements = Array.isArray(j.elements) ? structuredClone(j.elements) : [];
      this.selected = this.elements.length ? 0 : -1;
      this.render(); this.syncSelected();
    } catch { this.api.toast('Model JSON is invalid.', 'error'); }
  }
  syncSelected() {
    const e = this.elements[this.selected];
    ['fx','fy','fz','tx','ty','tz'].forEach(id => this.root.querySelector('#'+id).disabled = !e);
    if (!e) return;
    const vals = [...e.from, ...e.to]; ['fx','fy','fz','tx','ty','tz'].forEach((id,i) => this.root.querySelector('#'+id).value = vals[i]);
  }
  applyCube() {
    const e = this.elements[this.selected]; if (!e) return;
    e.from = ['fx','fy','fz'].map(id => n(this.root.querySelector('#'+id).value));
    e.to = ['tx','ty','tz'].map(id => n(this.root.querySelector('#'+id).value, 16));
    this.render();
  }
  project([x,y,z]) { const s = 18; return [380 + (x-z)*s, 390 - y*s + (x+z)*s*0.22]; }
  render() {
    const c = this.ctx; c.clearRect(0,0,760,560); c.fillStyle='#111722'; c.fillRect(0,0,760,560);
    c.strokeStyle='#253044'; c.lineWidth=1;
    for(let i=0;i<=16;i++){const a=this.project([i,0,0]),b=this.project([i,0,16]); c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke(); const d=this.project([0,0,i]),e=this.project([16,0,i]);c.beginPath();c.moveTo(...d);c.lineTo(...e);c.stroke();}
    const list=this.root.querySelector('#elementList'); list.innerHTML='';
    this.elements.forEach((el,index)=>{
      const [x1,y1,z1]=el.from,[x2,y2,z2]=el.to; const pts=[[x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1],[x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2]].map(p=>this.project(p));
      const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      c.strokeStyle=index===this.selected?'#ffb020':'#7f8da6'; c.lineWidth=index===this.selected?3:2; edges.forEach(([a,b])=>{c.beginPath();c.moveTo(...pts[a]);c.lineTo(...pts[b]);c.stroke();});
      const b=document.createElement('button'); b.className='element-chip'+(index===this.selected?' active':''); b.textContent=`Cube ${index+1} · [${el.from.join(',')}] → [${el.to.join(',')}]`; b.onclick=()=>{this.selected=index;this.render();this.syncSelected();}; list.appendChild(b);
    });
  }
  async save() {
    const path = this.root.querySelector('#modelPath').value.trim(); if (!path) return;
    const parent = this.root.querySelector('#modelParent').value.trim();
    const texture = this.root.querySelector('#modelTexture').value.trim();
    const j = {}; if (parent) j.parent=parent; if(texture) j.textures={layer0:texture,particle:texture}; if(this.elements.length) j.elements=this.elements;
    await this.api.updateFile(path, encoder.encode(JSON.stringify(j,null,2))); this.api.toast('Model saved.', 'success'); this.refreshList();
  }
}
