const decoder = new TextDecoder();

export class PixelEditor {
  constructor(root, api) {
    this.root = root;
    this.api = api;
    this.path = null;
    this.tool = 'pencil';
    this.color = '#ffb020';
    this.logical = 16;
    this.undo = [];
    this.redo = [];
    this.drawing = false;
    this.lastCell = '';
    this.build();
  }

  build() {
    this.root.innerHTML = `
      <section class="editor-shell pixel-shell">
        <div class="toolrail" aria-label="Pixel tools">
          <button data-tool="pencil" class="tool active" title="Pencil (B)" aria-label="Pencil">✎</button>
          <button data-tool="eraser" class="tool" title="Eraser (E)" aria-label="Eraser">⌫</button>
          <button data-tool="fill" class="tool" title="Fill (G)" aria-label="Fill">▣</button>
          <button data-tool="eyedropper" class="tool" title="Eyedropper (I)" aria-label="Eyedropper">⌾</button>
          <div class="tool-sep"></div>
          <button id="undoBtn" class="tool" title="Undo" aria-label="Undo">↶</button>
          <button id="redoBtn" class="tool" title="Redo" aria-label="Redo">↷</button>
        </div>
        <div class="canvas-stage">
          <div class="empty-state" id="pixelEmpty">
            <div class="empty-icon">▦</div>
            <h2>Select a PNG texture</h2>
            <p>Choose any PNG from the asset browser, or import one. Unknown textures are editable too.</p>
          </div>
          <div id="canvasWrap" class="canvas-wrap hidden"><canvas id="pixelCanvas"></canvas></div>
        </div>
        <aside class="inspector" id="pixelInspector">
          <div class="inspector-head"><span>Texture</span><span class="badge" id="textureDims">—</span></div>
          <label>Color<input id="colorInput" type="color" value="#ffb020"></label>
          <label>Logical resolution<select id="logicalSelect"></select></label>
          <div class="hint">Resolution Grid never resamples the master. Coarse mode changes only the high-resolution region you actually paint.</div>
          <div class="meta-grid">
            <span>Path</span><code id="texturePath">—</code>
            <span>Cell</span><code id="cellSize">1×1 px</code>
          </div>
          <button id="savePngBtn" class="secondary full">Commit texture now</button>
        </aside>
      </section>`;
    this.canvas = this.root.querySelector('#pixelCanvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.wrap = this.root.querySelector('#canvasWrap');
    this.empty = this.root.querySelector('#pixelEmpty');
    this.root.querySelectorAll('[data-tool]').forEach(btn => btn.onclick = () => this.setTool(btn.dataset.tool));
    this.root.querySelector('#colorInput').oninput = e => this.color = e.target.value;
    this.root.querySelector('#logicalSelect').onchange = e => { this.logical = Number(e.target.value); this.updateInspector(); this.drawGridOverlay(); };
    this.root.querySelector('#undoBtn').onclick = () => this.undoAction();
    this.root.querySelector('#redoBtn').onclick = () => this.redoAction();
    this.root.querySelector('#savePngBtn').onclick = () => this.commit();
    this.canvas.addEventListener('pointerdown', e => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.pointerMove(e));
    window.addEventListener('pointerup', () => this.pointerUp());
    window.addEventListener('resize', () => this.drawGridOverlay());
  }

  setTool(tool) {
    this.tool = tool;
    this.root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  }

  async load(path, bytes) {
    this.path = path;
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      this.canvas.width = bmp.width;
      this.canvas.height = bmp.height;
      this.ctx.clearRect(0, 0, bmp.width, bmp.height);
      this.ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      this.undo = []; this.redo = [];
      this.logical = Math.min(16, bmp.width);
      this.populateLogical();
      this.empty.classList.add('hidden');
      this.wrap.classList.remove('hidden');
      this.root.querySelector('#texturePath').textContent = path;
      this.updateInspector();
      this.drawGridOverlay();
    } catch (err) {
      this.api.toast(`PNG decode failed: ${err.message}`, 'error');
    }
  }

  populateLogical() {
    const sel = this.root.querySelector('#logicalSelect');
    const vals = [16, 32, 64, 128, 256, 512, 1024].filter(v => v <= this.canvas.width && this.canvas.width % v === 0);
    if (!vals.includes(this.canvas.width)) vals.push(this.canvas.width);
    sel.innerHTML = vals.map(v => `<option value="${v}" ${v === this.logical ? 'selected' : ''}>${v} px grid</option>`).join('');
    if (!vals.includes(this.logical)) this.logical = vals[0] || this.canvas.width;
  }

  cellSize() {
    return this.logical && this.canvas.width % this.logical === 0 ? Math.max(1, this.canvas.width / this.logical) : 1;
  }

  updateInspector() {
    if (!this.canvas.width) return;
    this.root.querySelector('#textureDims').textContent = `${this.canvas.width}×${this.canvas.height}`;
    const c = this.cellSize();
    this.root.querySelector('#cellSize').textContent = `${c}×${c} px`;
  }

  coords(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this.canvas.width - 1, Math.floor((e.clientX - r.left) * this.canvas.width / r.width))),
      y: Math.max(0, Math.min(this.canvas.height - 1, Math.floor((e.clientY - r.top) * this.canvas.height / r.height)))
    };
  }

  snapshot() {
    this.undo.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undo.length > 24) this.undo.shift();
    this.redo.length = 0;
  }

  pointerDown(e) {
    if (!this.path) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.coords(e);
    if (this.tool === 'eyedropper') { this.pick(p.x, p.y); return; }
    this.snapshot();
    if (this.tool === 'fill') { this.fill(p.x, p.y); this.commitSoon(); return; }
    this.drawing = true;
    this.lastCell = '';
    this.paint(p.x, p.y);
  }
  pointerMove(e) { if (this.drawing) { const p = this.coords(e); this.paint(p.x, p.y); } }
  pointerUp() { if (this.drawing) { this.drawing = false; this.lastCell = ''; this.commitSoon(); } }

  paint(x, y) {
    const c = this.cellSize();
    const gx = Math.floor(x / c) * c, gy = Math.floor(y / c) * c;
    const key = `${gx},${gy}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    if (this.tool === 'eraser') this.ctx.clearRect(gx, gy, c, c);
    else {
      this.ctx.fillStyle = this.color;
      this.ctx.fillRect(gx, gy, c, c);
    }
  }

  rgba(hex) {
    const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  same(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]; }
  sample(x, y) { return Array.from(this.ctx.getImageData(x, y, 1, 1).data); }
  pick(x, y) {
    const p = this.sample(x, y);
    this.color = '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
    this.root.querySelector('#colorInput').value = this.color;
  }

  fill(x, y) {
    const c = this.cellSize();
    const sx = Math.floor(x / c) * c, sy = Math.floor(y / c) * c;
    const target = this.sample(sx, sy), replacement = this.rgba(this.color);
    if (this.same(target, replacement)) return;
    const cols = Math.ceil(this.canvas.width / c), rows = Math.ceil(this.canvas.height / c);
    const seen = new Set(), q = [[Math.floor(sx / c), Math.floor(sy / c)]];
    this.ctx.fillStyle = this.color;
    while (q.length) {
      const [cx, cy] = q.pop();
      const k = `${cx},${cy}`;
      if (seen.has(k) || cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      seen.add(k);
      const px = cx * c, py = cy * c;
      if (!this.same(this.sample(px, py), target)) continue;
      this.ctx.fillRect(px, py, c, c);
      q.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  undoAction() {
    const img = this.undo.pop(); if (!img) return;
    this.redo.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.ctx.putImageData(img, 0, 0); this.commitSoon();
  }
  redoAction() {
    const img = this.redo.pop(); if (!img) return;
    this.undo.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.ctx.putImageData(img, 0, 0); this.commitSoon();
  }

  commitSoon() { clearTimeout(this.commitTimer); this.commitTimer = setTimeout(() => this.commit(), 250); }
  async commit() {
    if (!this.path) return;
    const blob = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    await this.api.updateFile(this.path, new Uint8Array(await blob.arrayBuffer()));
  }

  drawGridOverlay() {
    requestAnimationFrame(() => {
      if (!this.logical || !this.canvas.width) return;
      const displayCell = Math.max(3, this.canvas.getBoundingClientRect().width / this.logical);
      this.wrap.style.setProperty('--grid-size', `${displayCell}px`);
    });
  }
}
