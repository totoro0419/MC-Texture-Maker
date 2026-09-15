const DB_NAME = 'mc-texture-maker';
const DB_VERSION = 2;
let dbPromise;
function openDb(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'path'});if(!db.objectStoreNames.contains('vanillaFiles'))db.createObjectStore('vanillaFiles',{keyPath:'path'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});return dbPromise;}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));});}
export async function saveProjectMeta(meta){const db=await openDb();const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({...meta,updatedAt:Date.now()},'project');await txDone(tx);}
export async function replaceProject(entries,meta){const db=await openDb();const tx=db.transaction(['meta','files'],'readwrite');tx.objectStore('files').clear();for(const entry of entries){if(entry.directory)continue;tx.objectStore('files').put({path:entry.path,data:entry.data,dirty:!!entry.dirty});}tx.objectStore('meta').put({...meta,updatedAt:Date.now()},'project');await txDone(tx);}
export async function saveFile(path,data,dirty=true){const db=await openDb();const tx=db.transaction('files','readwrite');tx.objectStore('files').put({path,data,dirty});await txDone(tx);}
export async function deleteFile(path){const db=await openDb();const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(path);await txDone(tx);}
export async function loadProject(){const db=await openDb();const tx=db.transaction(['meta','files'],'readonly');const metaReq=tx.objectStore('meta').get('project');const filesReq=tx.objectStore('files').getAll();const meta=await new Promise((resolve,reject)=>{metaReq.onsuccess=()=>resolve(metaReq.result);metaReq.onerror=()=>reject(metaReq.error);});const files=await new Promise((resolve,reject)=>{filesReq.onsuccess=()=>resolve(filesReq.result);filesReq.onerror=()=>reject(filesReq.error);});await txDone(tx);if(!meta)return null;return {meta,entries:files.map(f=>({id:crypto.randomUUID(),path:f.path,data:new Uint8Array(f.data),directory:false,dirty:!!f.dirty}))};}
export async function clearProject(){const db=await openDb();const tx=db.transaction(['meta','files'],'readwrite');tx.objectStore('meta').clear();tx.objectStore('files').clear();await txDone(tx);}
export async function requestPersistentStorage(){if(!navigator.storage?.persist)return false;try{return await navigator.storage.persist();}catch{return false;}}
export async function storageEstimate(){if(!navigator.storage?.estimate)return null;try{return await navigator.storage.estimate();}catch{return null;}}

export async function getVanillaLibraryMeta() {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const req = tx.objectStore('meta').get('vanilla-library');
  const meta = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return meta;
}

export async function saveVanillaLibrary(entries, meta = {}) {
  const db = await openDb();
  const tx = db.transaction(['meta', 'vanillaFiles'], 'readwrite');
  const store = tx.objectStore('vanillaFiles');
  store.clear();
  let count = 0;
  for (const entry of entries) {
    if (entry.directory) continue;
    store.put({ path: entry.path, data: entry.data });
    count += 1;
  }
  tx.objectStore('meta').put({
    version: '1.8.9',
    count,
    sourceName: meta.sourceName || 'local 1.8.9 client JAR',
    importedAt: Date.now(),
  }, 'vanilla-library');
  await txDone(tx);
  return count;
}

export async function loadVanillaLibrary() {
  const db = await openDb();
  const tx = db.transaction(['meta', 'vanillaFiles'], 'readonly');
  const metaReq = tx.objectStore('meta').get('vanilla-library');
  const filesReq = tx.objectStore('vanillaFiles').getAll();
  const meta = await new Promise((resolve, reject) => {
    metaReq.onsuccess = () => resolve(metaReq.result || null);
    metaReq.onerror = () => reject(metaReq.error);
  });
  const files = await new Promise((resolve, reject) => {
    filesReq.onsuccess = () => resolve(filesReq.result || []);
    filesReq.onerror = () => reject(filesReq.error);
  });
  await txDone(tx);
  if (!meta) return null;
  return {
    meta,
    entries: files.map(file => ({
      id: crypto.randomUUID(),
      path: file.path,
      data: new Uint8Array(file.data),
      directory: false,
      dirty: false,
      baseline: true,
    })),
  };
}

export async function clearVanillaLibrary() {
  const db = await openDb();
  const tx = db.transaction(['meta', 'vanillaFiles'], 'readwrite');
  tx.objectStore('meta').delete('vanilla-library');
  tx.objectStore('vanillaFiles').clear();
  await txDone(tx);
}
