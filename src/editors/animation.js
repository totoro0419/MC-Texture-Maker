const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class AnimationStudio {
  constructor(root, api) { this.root = root; this.api = api; this.path = null; this.frames = 1; this.frame = 0; this.timer = null; this.build(); }
  build() {
    this.root.innerHTML = `
      <section class="studio-layout">
        <div class="studio-main">
          <div class="studio-title"><div><span class="eyebrow">VANILLA 1.8.9</span><h2>Animation Studio</h2></div><button id="animPlay" class="primary">▶ Play</button></div>
          <div class="animation-preview"><canvas id="animCanvas" width="320" height="320"></canvas></div>
          <div class="timeline"><input id="frameRange" type="range" min="0" max="0" value="0"><div id="frameStrip" class="frame-strip"></div></div>
        </div>
        <aside class="inspector">
          <div class="inspector-head"><span>Animation</span><span class="badge" id="animCount">—</span></div>
          <label>Texture<select id="animTexture"></select></label>
          <label>Frame time (ticks)<input id="frametime" type="number" min="1" value="2"></label>
          <label class="check"><input id="interpolate" type="checkbox"> Interpolate frames</label>
          <label>Frame order<input id="frameOrder" type="text" placeholder="0,1,2,3 …"></label>
          <div class="hint">A vertical strip is split into square frames using its width. The generated <code>.png.mcmeta</code> is compatible with Java 1.8.9.</div>
          <button id="saveAnim" class="primary full">Save animation metadata</button>
        </aside>
      </section>`;
    this.canvas = this.root.querySelector('#animCanvas'); this.ctx = this.canvas.getContext('2d');
    this.root.querySelector('#animTexture').onchange = e => this.load(e.target.value);
    this.root.querySelector('#frameRange').oninput = e => { this.frame = Number(e.target.value); this.draw(); };
    this.root.querySelector('#animPlay').onclick = () => this.togglePlay();
    this.root.querySelector('#saveAnim').onclick = () => this.save();
  }
  refreshList() {
    const files = this.api.entries().filter(e => /\.png$/i.test(e.path) && !e.directory);
    const sel = this.root.querySelector('#animTexture');
    sel.innerHTML = `<option value="">Choose texture…</option>` + files.map(e => `<option value="${e.path.replace(/"/g, '&quot;')}">${e.path}</option>`).join('');
    if (this.path) sel.value = this.path;
  }
  async load(path) {
    if (!path) return; this.path = path;
    const entry = this.api.getFile(path); if (!entry) return;
    const bmp = await createImageBitmap(new Blob([entry.data], { type: 'image/png' }));
    this.bitmap?.close?.(); this.bitmap = bmp;
    this.frameSize = bmp.width;
    this.frames = Math.max(1, Math.floor(bmp.height / bmp.width));
    this.frame = 0;
    const range = this.root.querySelector('#frameRange'); range.max = String(this.frames - 1); range.value = '0';
    this.root.querySelector('#animCount').textContent = `${this.frames} frames`;
    this.root.querySelector('#frameOrder').value = Array.from({ length: this.frames }, (_, i) => i).join(',');
    const meta = this.api.getFile(path + '.mcmeta');
    if (meta) {
      try {
        const j = JSON.parse(decoder.decode(meta.data));
        this.root.querySelector('#frametime').value = j.animation?.frametime ?? 1;
        this.root.querySelector('#interpolate').checked = !!j.animation?.interpolate;
        if (Array.isArray(j.animation?.frames)) this.root.querySelector('#frameOrder').value = j.animation.frames.map(f => typeof f === 'number' ? f : f.index).join(',');
      } catch {}
    }
    this.renderStrip(); this.draw();
  }
  renderStrip() {
    const strip = this.root.querySelector('#frameStrip');
    strip.innerHTML = Array.from({ length: Math.min(this.frames, 80) }, (_, i) => `<button class="frame-chip ${i === this.frame ? 'active' : ''}" data-frame="${i}">${i}</button>`).join('');
    strip.querySelectorAll('button').forEach(b => b.onclick = () => { this.frame = Number(b.dataset.frame); this.root.querySelector('#frameRange').value = String(this.frame); this.draw(); this.renderStrip(); });
  }
  draw() {
    if (!this.bitmap) return;
    const ctx = this.ctx; ctx.clearRect(0, 0, 320, 320); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bitmap, 0, this.frame * this.frameSize, this.frameSize, this.frameSize, 0, 0, 320, 320);
    this.root.querySelectorAll('.frame-chip').forEach(b => b.classList.toggle('active', Number(b.dataset.frame) === this.frame));
  }
  togglePlay() {
    const btn = this.root.querySelector('#animPlay');
    if (this.timer) { clearInterval(this.timer); this.timer = null; btn.textContent = '▶ Play'; return; }
    const tick = Math.max(1, Number(this.root.querySelector('#frametime').value)) * 50;
    this.timer = setInterval(() => { this.frame = (this.frame + 1) % this.frames; this.root.querySelector('#frameRange').value = String(this.frame); this.draw(); }, tick);
    btn.textContent = '■ Stop';
  }
  async save() {
    if (!this.path) return this.api.toast('Choose an animated PNG first.', 'error');
    const frametime = Math.max(1, Number(this.root.querySelector('#frametime').value) || 1);
    const frames = this.root.querySelector('#frameOrder').value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 0 && n < this.frames);
    const animation = { frametime };
    if (this.root.querySelector('#interpolate').checked) animation.interpolate = true;
    if (frames.length && (frames.length !== this.frames || frames.some((v, i) => v !== i))) animation.frames = frames;
    await this.api.updateFile(this.path + '.mcmeta', encoder.encode(JSON.stringify({ animation }, null, 2)));
    this.api.toast('Animation metadata saved.', 'success');
  }
}
