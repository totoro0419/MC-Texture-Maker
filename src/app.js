import { readZip, writeZip } from './zip.js';
import * as storage from './storage.js';
import { classify, validate, counts } from './validators.js';
import { PixelEditor } from './editors/pixel.js';
import { AnimationStudio } from './editors/animation.js';
import { ModelStudio } from './editors/model.js';
import { SkyStudio } from './editors/sky.js';
import { AdvancedStudio } from './editors/advanced.js';

const encoder = new TextEncoder();

class App {
  constructor() {
    this.files = new Map();
    this.meta = { name: 'Untitled Pack', target: 'Minecraft Java 1.8.9 + OptiFine M5' };
    this.filter = 'All'; this.query = ''; this.workspace = 'texture'; this.problemList = [];
    this.buildEditors(); this.bind(); this.restore();
  }
  buildEditors() {
    const api = {
      entries: () => [...this.files.values()], getFile: p => this.files.get(p), updateFile: (p,d) => this.updateFile(p,d), toast: (m,t) => this.toast(m,t), problems: () => this.problemList, revalidate: () => this.revalidate()
    };
    this.pixel = new PixelEditor(document.querySelector('#workspaceTexture'), api);
    this.animation = new AnimationStudio(document.querySelector('#workspaceAnimate'), api);
    this.model = new ModelStudio(document.querySelector('#workspace3d'), api);
    this.sky = new SkyStudio(document.querySelector('#workspaceSky'), api);
    this.advanced = new AdvancedStudio(document.querySelector('#workspaceAdvanced'), api);
  }
  bind() {
    document.querySelector('#zipInput').onchange = e => e.target.files[0] && this.importZip(e.target.files[0]);
    document.querySelector('#pngInput').onchange = e => e.target.files[0] && this.importPng(e.target.files[0]);
    document.querySelector('#importBtn').onclick = () => document.querySelector('#zipInput').click();
    document.querySelector('#importPngBtn').onclick = () => document.querySelector('#pngInput').click();
    document.querySelector('#newBtn').onclick = () => this.newPack();
    document.querySelector('#exportBtn').onclick = () => this.exportZip();
    document.querySelector('#validateBtn').onclick = () => { this.revalidate(); this.switchWorkspace('advanced'); this.advanced.show('problems'); };
    document.querySelector('#assetSearch').oninput = e => { this.query = e.target.value.trim().toLowerCase(); this.renderAssets(); };
    document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { this.filter=b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b)); this.renderAssets(); });
    document.querySelectorAll('[data-workspace]').forEach(b => b.onclick = () => this.switchWorkspace(b.dataset.workspace));
    document.addEventListener('keydown', e => this.shortcuts(e));
    window.addEventListener('beforeunload', () => storage.saveProjectMeta(this.meta));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  async restore() {
    this.setSaveState('Restoring…');
    try {
      const restored = await storage.loadProject();
      if (restored?.entries?.length) {
        this.meta = restored.meta; this.files = new Map(restored.entries.map(e=>[e.path,e])); this.toast(`Restored ${this.files.size} autosaved files.`, 'success');
      } else await this.newPack(false);
      await storage.requestPersistentStorage();
    } catch (e) { await this.newPack(false); this.toast('Autosave restore failed: '+e.message,'error'); }
    this.afterProjectChange(); this.setSaveState('Saved locally');
  }
  async newPack(confirmFirst=true) {
    if (confirmFirst && this.files.size && !confirm('Start a new pack? The current project stays in your downloaded ZIP only if you exported it.')) return;
    this.files.clear();
    const mcmeta = encoder.encode(JSON.stringify({ pack: { pack_format: 1, description: 'Made with MC Texture Maker' } }, null, 2));
    this.files.set('pack.mcmeta',{id:crypto.randomUUID(),path:'pack.mcmeta',data:mcmeta,directory:false,dirty:true});
    this.meta={name:'New 1.8.9 Pack',target:'Minecraft Java 1.8.9 + OptiFine M5'};
    await storage.replaceProject([...this.files.values()],this.meta); this.afterProjectChange();
  }
  async importZip(file) {
    this.modal(true, 'Reading ZIP…', 'Indexing the resource pack without decoding every PNG.');
    try {
      const entries = await readZip(await file.arrayBuffer(), (p,name)=>this.modalProgress(p, name));
      this.files = new Map(entries.filter(e=>!e.directory).map(e=>[e.path,e]));
      this.meta={name:file.name.replace(/\.zip$/i,''),target:'Minecraft Java 1.8.9 + OptiFine M5',importedAt:Date.now()};
      this.modalTitle('Saving local project…'); await storage.replaceProject([...this.files.values()],this.meta);
      this.afterProjectChange(); this.toast(`Imported ${this.files.size.toLocaleString()} files.`, 'success');
    } catch(e){this.toast(e.message,'error');} finally { this.modal(false); document.querySelector('#zipInput').value=''; }
  }
  async importPng(file) {
    const selected = this.pixel.path;
    const fallback = selected && /\.png$/i.test(selected) ? selected : `assets/minecraft/textures/items/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const path = prompt('Resource-pack path for this PNG:', fallback); if(!path)return;
    const data=new Uint8Array(await file.arrayBuffer()); await this.updateFile(path,data); this.renderAssets(); await this.pixel.load(path,data); this.switchWorkspace('texture');
  }
  async updateFile(path,data) {
    if(!path)return; const old=this.files.get(path); this.files.set(path,{id:old?.id||crypto.randomUUID(),path,data,directory:false,dirty:true});
    this.setSaveState('Saving…'); try{await storage.saveFile(path,data,true);this.setSaveState('Saved locally');}catch(e){this.setSaveState('Save failed');this.toast(e.message,'error');}
    this.revalidate(false); this.refreshStudios();
  }
  afterProjectChange(){document.querySelector('#projectName').textContent=this.meta.name;this.revalidate(false);this.renderSummary();this.renderAssets();this.refreshStudios();}
  refreshStudios(){this.animation.refreshList();this.model.refreshList();this.sky.refreshList();}
  renderSummary(){const c=counts([...this.files.values()]);document.querySelector('#assetCount').textContent=`${this.files.size.toLocaleString()} files`;const top=Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,5);document.querySelector('#summaryChips').innerHTML=top.map(([k,v])=>`<span>${k} <b>${v}</b></span>`).join('');}
  renderAssets(){const list=document.querySelector('#assetList');let entries=[...this.files.values()].filter(e=>!e.directory);if(this.filter!=='All')entries=entries.filter(e=>classify(e.path)===this.filter);if(this.query)entries=entries.filter(e=>e.path.toLowerCase().includes(this.query));entries.sort((a,b)=>a.path.localeCompare(b.path));const shown=entries.slice(0,500);list.innerHTML=shown.map(e=>{const cat=classify(e.path);const name=e.path.split('/').pop();return `<button class="asset-row" data-path="${e.path.replace(/"/g,'&quot;')}"><span class="asset-icon ${cat.toLowerCase()}">${/\.png$/i.test(e.path)?'▧':/\.json$/i.test(e.path)?'{}':'≡'}</span><span class="asset-text"><strong>${name}</strong><small>${cat} · ${e.path}</small></span>${e.dirty?'<i class="dirty-dot"></i>':''}</button>`;}).join('')+(entries.length>500?`<div class="list-note">Showing 500 of ${entries.length}. Refine search to narrow the list.</div>`:'');list.querySelectorAll('[data-path]').forEach(b=>b.onclick=()=>this.openAsset(b.dataset.path));}
  async openAsset(path){const e=this.files.get(path);if(!e)return;if(/\.png$/i.test(path)){this.switchWorkspace('texture');await this.pixel.load(path,e.data);}else if(/assets\/minecraft\/models\/.*\.json$/i.test(path)){this.switchWorkspace('3d');this.model.load(path);}else if(/mcpatcher\/sky\/.*\.properties$/i.test(path)){this.switchWorkspace('sky');this.sky.load(path);}else{this.switchWorkspace('advanced');this.advanced.show('raw');setTimeout(()=>{const btn=[...document.querySelectorAll('#workspaceAdvanced [data-path]')].find(x=>x.dataset.path===path);btn?.click();},0);}}
  switchWorkspace(name){this.workspace=name;document.querySelectorAll('.workspace').forEach(w=>w.classList.add('hidden'));document.querySelector(`#workspace${name==='3d'?'3d':name[0].toUpperCase()+name.slice(1)}`)?.classList.remove('hidden');document.querySelectorAll('[data-workspace]').forEach(b=>b.classList.toggle('active',b.dataset.workspace===name));if(name==='animate')this.animation.refreshList();if(name==='3d')this.model.refreshList();if(name==='sky')this.sky.refreshList();if(name==='advanced')this.advanced.problems();}
  revalidate(render=true){this.problemList=validate([...this.files.values()]);const errs=this.problemList.filter(p=>p.severity==='error').length;document.querySelector('#problemBadge').textContent=this.problemList.length;document.querySelector('#problemBadge').classList.toggle('danger',errs>0);if(render&&this.workspace==='advanced')this.advanced.problems();return this.problemList;}
  async exportZip(){this.revalidate(false);const errors=this.problemList.filter(p=>p.severity==='error').length;if(errors&&!confirm(`${errors} validation error(s) remain. Export anyway?`))return;this.modal(true,'Building Minecraft ZIP…','Preserving every unknown file while regenerating only files you changed.');try{const blob=writeZip([...this.files.values()]);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(this.meta.name||'resource-pack').replace(/[^a-z0-9._-]+/gi,'_')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);this.toast(`Exported ${(blob.size/1024/1024).toFixed(1)} MB ZIP.`,'success');}catch(e){this.toast('Export failed: '+e.message,'error');}finally{this.modal(false);}}
  shortcuts(e){if(e.target.matches('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?this.pixel.redoAction():this.pixel.undoAction();}if(e.key.toLowerCase()==='b')this.pixel.setTool('pencil');if(e.key.toLowerCase()==='e')this.pixel.setTool('eraser');if(e.key.toLowerCase()==='g')this.pixel.setTool('fill');if(e.key.toLowerCase()==='i')this.pixel.setTool('eyedropper');}
  setSaveState(t){document.querySelector('#saveState').textContent=t;}
  toast(msg,type='info'){const c=document.querySelector('#toasts');const d=document.createElement('div');d.className=`toast ${type}`;d.textContent=msg;c.appendChild(d);setTimeout(()=>d.classList.add('show'),10);setTimeout(()=>{d.classList.remove('show');setTimeout(()=>d.remove(),250);},3800);}
  modal(show,title='',sub=''){const m=document.querySelector('#busyModal');m.classList.toggle('hidden',!show);if(show){this.modalTitle(title);document.querySelector('#busySub').textContent=sub;this.modalProgress(0,'');}}
  modalTitle(t){document.querySelector('#busyTitle').textContent=t;}
  modalProgress(p,name){document.querySelector('#busyBar').style.width=`${Math.round(p*100)}%`;document.querySelector('#busyFile').textContent=name||'';}
}

new App();
