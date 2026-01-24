

(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const stage = $('#stage');
  const tpl = $('#winTpl');

  const fileInput = $('#fileInput');
  const loadInput = $('#loadInput');
  const toggleEditBtn = $('#toggleEditBtn');
  const saveBtn = $('#saveBtn');
  const clearBtn = $('#clearBtn');

  let editMode = true;
  let zCounter = 1000;

  // id -> { title, dataURL }
  const meta = new Map();

  // ----------------------------
  // IndexedDB (auto persist)
  // ----------------------------
  const DB_NAME = 'image-window-board';
  const DB_VER  = 1;
  const STORE   = 'kv';
  const KEY     = 'state_v6';

  function openDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)){
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error || new Error('IndexedDB open error'));
    });
  }

  async function idbGet(key){
    const db = await openDB();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      const req = st.get(key);
      req.onsuccess = ()=> resolve(req.result?.value ?? null);
      req.onerror = ()=> reject(req.error || new Error('IndexedDB get error'));
    });
  }

  async function idbSet(key, value){
    const db = await openDB();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const req = st.put({ key, value });
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error || new Error('IndexedDB put error'));
    });
  }

  async function idbDel(key){
    const db = await openDB();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const req = st.delete(key);
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error || new Error('IndexedDB delete error'));
    });
  }

  let persistTimer = null;
  function schedulePersist(delay=500){
    clearTimeout(persistTimer);
    persistTimer = setTimeout(()=>{ persistNow().catch(()=>{}); }, delay);
  }

  async function persistNow(){
    const data = buildExport();
    try{
      await idbSet(KEY, data);
    }catch(err){
      // 容量不足など1回だけ通知。
      console.warn('persist failed', err);
    }
  }

  // ----------------------------
  // utils
  // ----------------------------
  function uid(){
    if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return 'id_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function setEditMode(on){
    editMode = !!on;
    document.body.classList.toggle('is-edit', editMode);
    toggleEditBtn.setAttribute('aria-pressed', String(editMode));
    toggleEditBtn.textContent = `編集モード: ${editMode ? 'ON' : 'OFF'}`;
    schedulePersist();
  }

  function bringToFront(win){
    zCounter += 1;
    win.style.zIndex = String(zCounter);
    schedulePersist(350);
  }

  function isImageFile(f){
    if(!f) return false;
    if(f.type?.startsWith('image/')) return true;
    const n = (f.name || '').toLowerCase();
    return n.endsWith('.heic') || n.endsWith('.heif') || n.endsWith('.webp') || n.endsWith('.avif');
  }

  function isHeic(f){
    const t = (f.type || '').toLowerCase();
    if(t.includes('heic') || t.includes('heif')) return true;
    const n = (f.name || '').toLowerCase();
    return n.endsWith('.heic') || n.endsWith('.heif');
  }

  function blobToDataURL(blob){
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(String(r.result || ''));
      r.onerror = ()=> reject(r.error || new Error('read failed'));
      r.readAsDataURL(blob);
    });
  }

  async function fileToDataURL(file){
    if(isHeic(file)){
      const conv = globalThis.heic2any;
      if(typeof conv !== 'function'){
        throw new Error('HEIC/HEIF 変換ライブラリ（heic2any）が読み込めていません。オンラインで開くか、オフライン同梱版にしてください。');
      }
      const out = await conv({ blob: file, toType: 'image/png', quality: 0.92 });
      const blob = Array.isArray(out) ? out[0] : out;
      return await blobToDataURL(blob);
    }
    return await blobToDataURL(file);
  }

  function stageBaseMin(){
    const viewW = stage.clientWidth || window.innerWidth;
    const viewH = stage.clientHeight || window.innerHeight;
    return {
      w: Math.max(1200, Math.ceil(viewW * 1.4)),
      h: Math.max(900, Math.ceil(viewH * 1.4)),
    };
  }

  function recomputeStageBounds(){
    const pad = 240;
    const base = stageBaseMin();
    let maxR = 0;
    let maxB = 0;

    $$('.win', stage).forEach(win=>{
      const left = parseFloat(win.style.left || '0') || 0;
      const top  = parseFloat(win.style.top  || '0') || 0;
      maxR = Math.max(maxR, left + win.offsetWidth);
      maxB = Math.max(maxB, top + win.offsetHeight);
    });

    stage.style.minWidth  = Math.max(base.w, Math.ceil(maxR + pad)) + 'px';
    stage.style.minHeight = Math.max(base.h, Math.ceil(maxB + pad)) + 'px';
  }

  function setCollapsed(win, collapsed){
    const btn = win.querySelector('[data-act="collapse"]');
    const header = win.querySelector('.win__header');

    if(collapsed){
      win.dataset.prevH = String(win.getBoundingClientRect().height);
      win.dataset.prevMinH = String(win.style.minHeight || '');
      win.classList.add('is-collapsed');

      const hh = (header?.offsetHeight || 38);
      win.style.height = hh + 'px';
      win.style.minHeight = hh + 'px';
      if(btn) btn.textContent = '表示';
    }else{
      win.classList.remove('is-collapsed');

      const prevH = parseFloat(win.dataset.prevH || '');
      win.style.height = (isFinite(prevH) && prevH > 60 ? prevH : 320) + 'px';

      const prevMinH = win.dataset.prevMinH;
      win.style.minHeight = prevMinH || '';
      if(btn) btn.textContent = '非表示';
    }
    recomputeStageBounds();
    schedulePersist();
  }

  function setWindowTitle(win, title){
    const titleEl = $('.win__title', win);
    if(titleEl) titleEl.textContent = title || 'image';
  }

  function setWindowImageByDataURL(win, title, dataURL){
    const id = win.dataset.id;
    const img = $('.win__img', win);
    if(img){
      img.src = dataURL;
      img.alt = title || 'image';
    }
    setWindowTitle(win, title);
    if(id) meta.set(id, { title, dataURL });
    schedulePersist();
  }

  async function setWindowImageByFile(win, file){
    const dataURL = await fileToDataURL(file);
    setWindowImageByDataURL(win, file.name || 'image', dataURL);
  }

  function createWindow({
    id = uid(),
    title = 'image',
    dataURL = '',
    left = 20,
    top = 20,
    width = 420,
    height = 320,
    z = null,
    collapsed = false,
  } = {}){
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = id;

    node.style.left = Math.max(0, left) + 'px';
    node.style.top = Math.max(0, top) + 'px';
    node.style.width = Math.max(240, width) + 'px';
    node.style.height = Math.max(180, height) + 'px';

    if(z !== null && z !== undefined){
      node.style.zIndex = String(z);
      zCounter = Math.max(zCounter, Number(z) || zCounter);
    }else{
      bringToFront(node);
    }

    setWindowTitle(node, title);

    const img = $('.win__img', node);
    if(img){
      img.src = dataURL;
      img.alt = title;
    }

    meta.set(id, { title, dataURL });

    attachWindowEvents(node);
    stage.appendChild(node);

    if(collapsed) setCollapsed(node, true);

    resizeObserver.observe(node);
    recomputeStageBounds();

    return node;
  }

  const drag = { active:false, win:null, pid:null, startX:0, startY:0, startL:0, startT:0 };

  function attachWindowEvents(win){
    const header = $('.win__header', win);

    win.addEventListener('pointerdown', ()=>{
      bringToFront(win);
    });

    // drag move (edit mode only)
    header?.addEventListener('pointerdown', (e)=>{
      if(!editMode) return;
      if(e.target.closest('button')) return;

      bringToFront(win);

      drag.active = true;
      drag.win = win;
      drag.pid = e.pointerId;

      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startL = parseFloat(win.style.left || '0') || 0;
      drag.startT = parseFloat(win.style.top  || '0') || 0;

      win.classList.add('is-dragging');
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    header?.addEventListener('pointermove', (e)=>{
      if(!drag.active || drag.pid !== e.pointerId) return;
      if(!drag.win) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      const nl = Math.max(0, drag.startL + dx);
      const nt = Math.max(0, drag.startT + dy);

      drag.win.style.left = nl + 'px';
      drag.win.style.top  = nt + 'px';

      recomputeStageBounds();
      schedulePersist(600);
    });

    function endDrag(e){
      if(!drag.active) return;
      if(e && drag.pid !== e.pointerId) return;

      if(drag.win) drag.win.classList.remove('is-dragging');
      drag.active = false;
      drag.win = null;
      drag.pid = null;
      schedulePersist(250);
    }

    header?.addEventListener('pointerup', endDrag);
    header?.addEventListener('pointercancel', endDrag);

    // action buttons
    win.addEventListener('click', (e)=>{
      const act = e.target?.closest('button')?.dataset?.act;
      if(!act) return;

      if(act === 'delete'){
        removeWindow(win);
      }else if(act === 'collapse'){
        setCollapsed(win, !win.classList.contains('is-collapsed'));
      }
    });

    header?.addEventListener('dblclick', ()=>{
      setCollapsed(win, !win.classList.contains('is-collapsed'));
    });

    // drop highlight (overlay appears centered in this window)
    win.addEventListener('dragenter', (e)=>{
      if(!hasFilesType(e.dataTransfer)) return;
      if(!hasUsableImageFiles(e.dataTransfer)) return;
      win.classList.add('is-drop-target');
    });
    win.addEventListener('dragleave', (e)=>{
      if(win.contains(e.relatedTarget)) return;
      win.classList.remove('is-drop-target');
    });
    win.addEventListener('drop', ()=>{
      win.classList.remove('is-drop-target');
    });
  }

  function removeWindow(win){
    const id = win.dataset.id;
    resizeObserver.unobserve(win);
    win.remove();
    if(id) meta.delete(id);
    recomputeStageBounds();
    schedulePersist();
  }

  const resizeObserver = new ResizeObserver((entries)=>{
    for(const ent of entries){
      const win = ent.target;
      if(!(win instanceof HTMLElement)) continue;
      if(win.classList.contains('is-collapsed')){
        const header = win.querySelector('.win__header');
        const hh = (header?.offsetHeight || 38);
        win.style.height = hh + 'px';
        win.style.minHeight = hh + 'px';
      }
    }
    recomputeStageBounds();
    schedulePersist(700);
  });

  // persist stage scroll position too
  stage.addEventListener('scroll', ()=>{
    schedulePersist(800);
  }, { passive: true });

  // ---- add images (button) ----
  fileInput.addEventListener('change', async ()=>{
    const files = Array.from(fileInput.files || []).filter(isImageFile);
    fileInput.value = '';
    if(files.length === 0) return;

    const baseLeft = 20 + (Math.random()*20)|0;
    const baseTop  = 20 + (Math.random()*20)|0;
    const offset = 28;

    for(let i=0;i<files.length;i++){
      const f = files[i];
      let dataURL = '';
      try{
        dataURL = await fileToDataURL(f);
      }catch(err){
        alert(String(err?.message || err || '画像の読み込みに失敗しました'));
        continue;
      }

      createWindow({
        title: f.name || 'image',
        dataURL,
        left: baseLeft + i*offset,
        top: baseTop + i*offset,
        width: 480,
        height: 360,
      });
    }
    schedulePersist();
  });

  // ---- toggle edit ----
  toggleEditBtn.addEventListener('click', ()=>{
    setEditMode(!editMode);
  });

  // Ctrl/Cmd + E
  window.addEventListener('keydown', (e)=>{
    if(e.key?.toLowerCase() === 'e' && (e.ctrlKey || e.metaKey)){
      e.preventDefault();
      setEditMode(!editMode);
    }
  });

  // ---- export JSON ----
  function buildExport(){
    const wins = $$('.win', stage).map(win=>{
      const id = win.dataset.id || uid();
      const m = meta.get(id) || {
        title: $('.win__title', win)?.textContent || 'image',
        dataURL: $('.win__img', win)?.src || ''
      };

      const left = parseFloat(win.style.left || '0') || 0;
      const top  = parseFloat(win.style.top  || '0') || 0;

      const rect = win.getBoundingClientRect();
      const width  = rect.width;
      const height = rect.height;

      const z = parseInt(win.style.zIndex || '0', 10) || 0;
      const collapsed = win.classList.contains('is-collapsed');

      return { id, title: m.title, dataURL: m.dataURL, left, top, width, height, z, collapsed };
    });

    return {
      app: 'image-window-board',
      version: 6,
      exportedAt: new Date().toISOString(),
      editMode,
      zCounter,
      stage: {
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
        minWidth: stage.style.minWidth || '',
        minHeight: stage.style.minHeight || '',
      },
      windows: wins
    };
  }

  function downloadText(filename, text){
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
  }

  saveBtn.addEventListener('click', ()=>{
    const data = buildExport();
    const ts = new Date();
    const pad2 = (n)=> String(n).padStart(2,'0');
    const name = `image_windows_${ts.getFullYear()}${pad2(ts.getMonth()+1)}${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}.json`;
    downloadText(name, JSON.stringify(data, null, 2));
  });

  // ---- import JSON ----
  function clearAll({persist=true} = {}){
    $$('.win', stage).forEach(w=>{
      resizeObserver.unobserve(w);
      w.remove();
    });
    meta.clear();
    zCounter = 1000;
    recomputeStageBounds();
    if(persist) schedulePersist();
  }

  loadInput.addEventListener('change', async ()=>{
    const f = loadInput.files?.[0];
    loadInput.value = '';
    if(!f) return;

    const text = await f.text().catch(()=> '');
    if(!text) return;

    let data = null;
    try{
      data = JSON.parse(text);
    }catch{
      alert('JSONの読み込みに失敗しました（形式が不正です）');
      return;
    }

    if(!data || data.app !== 'image-window-board'){
      const ok = confirm('このJSONは別形式かもしれません。読み込みを試しますか？');
      if(!ok) return;
    }

    clearAll({persist:false});

    setEditMode(data?.editMode ?? true);
    zCounter = Number(data?.zCounter || 1000) || 1000;

    const wins = Array.isArray(data?.windows) ? data.windows : [];
    wins.forEach(w=>{
      createWindow({
        id: w.id || uid(),
        title: w.title || 'image',
        dataURL: w.dataURL || '',
        left: Number(w.left || 0),
        top: Number(w.top || 0),
        width: Number(w.width || 420),
        height: Number(w.height || 320),
        z: Number(w.z || 0),
        collapsed: !!w.collapsed,
      });
    });

    if(data?.stage){
      if(typeof data.stage.minWidth === 'string') stage.style.minWidth = data.stage.minWidth;
      if(typeof data.stage.minHeight === 'string') stage.style.minHeight = data.stage.minHeight;

      stage.scrollLeft = Number(data.stage.scrollLeft || 0);
      stage.scrollTop  = Number(data.stage.scrollTop || 0);
    }

    recomputeStageBounds();
    schedulePersist(150);
  });

  // ---- clear ----
  clearBtn.addEventListener('click', async ()=>{
    const ok = confirm('画像ウィンドウをすべて削除します。よろしいですか？');
    if(!ok) return;
    clearAll({persist:false});
    try{ await idbDel(KEY); }catch{}
  });

  // ---- DnD: anywhere ----
  function hasFilesType(dt){
    const types = Array.from(dt?.types || []);
    return types.includes('Files');
  }

  function hasUsableImageFiles(dt){
    const files = Array.from(dt?.files || []);
    return files.some(isImageFile);
  }

  function getStageCoordsFromClient(clientX, clientY){
    const stageRect = stage.getBoundingClientRect();
    return {
      x: (clientX - stageRect.left) + stage.scrollLeft,
      y: (clientY - stageRect.top) + stage.scrollTop
    };
  }

  async function handleDropEvent(e){
    const files = Array.from(e.dataTransfer?.files || []).filter(isImageFile);
    if(files.length === 0) return;

    const win = e.target?.closest?.('.win') || null;
    const { x: dropX, y: dropY } = getStageCoordsFromClient(e.clientX, e.clientY);

    // 窓の上: 置換
    if(win){
      bringToFront(win);

      try{
        await setWindowImageByFile(win, files[0]);
      }catch(err){
        alert(String(err?.message || err || '画像の読み込みに失敗しました'));
        return;
      }

      // 残りは新規
      for(let i=1;i<files.length;i++){
        const f = files[i];
        let dataURL = '';
        try{
          dataURL = await fileToDataURL(f);
        }catch(err){
          alert(String(err?.message || err || '画像の読み込みに失敗しました'));
          continue;
        }
        createWindow({
          title: f.name || 'image',
          dataURL,
          left: dropX + i*24,
          top:  dropY + i*24,
          width: 480,
          height: 360,
        });
      }
      schedulePersist();
      return;
    }

    // 空きスペース: 新規
    for(let i=0;i<files.length;i++){
      const f = files[i];
      let dataURL = '';
      try{
        dataURL = await fileToDataURL(f);
      }catch(err){
        alert(String(err?.message || err || '画像の読み込みに失敗しました'));
        continue;
      }
      createWindow({
        title: f.name || 'image',
        dataURL,
        left: dropX + i*24,
        top:  dropY + i*24,
        width: 480,
        height: 360,
      });
    }
    schedulePersist();
  }

  // --- global drag state (for overlay) ---
  let dragDepth = 0;
  function setDragging(on){
    document.body.classList.toggle('is-dragging-files', !!on);
  }

  document.addEventListener('dragenter', (e)=>{
    if(!hasFilesType(e.dataTransfer)) return;
    if(!hasUsableImageFiles(e.dataTransfer)) return;
    dragDepth += 1;
    setDragging(true);
  }, true);

  document.addEventListener('dragleave', (e)=>{
    if(!hasFilesType(e.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if(dragDepth === 0) setDragging(false);
  }, true);

  document.addEventListener('dragover', (e)=>{
    if(!hasFilesType(e.dataTransfer)) return;
    e.preventDefault();
    try{ e.dataTransfer.dropEffect = 'copy'; }catch{}
  }, true);

  document.addEventListener('drop', async (e)=>{
    if(!hasFilesType(e.dataTransfer)) return;
    if(!hasUsableImageFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth = 0;
    setDragging(false);
    await handleDropEvent(e);
  }, true);

  // ----------------------------
  // bootstrap: restore persisted state if exists
  // ----------------------------
  async function restoreIfPossible(){
    try{
      const data = await idbGet(KEY);
      if(!data || !data.windows) return;
      // restore
      clearAll({persist:false});
      setEditMode(data?.editMode ?? true);
      zCounter = Number(data?.zCounter || 1000) || 1000;

      const wins = Array.isArray(data?.windows) ? data.windows : [];
      wins.forEach(w=>{
        createWindow({
          id: w.id || uid(),
          title: w.title || 'image',
          dataURL: w.dataURL || '',
          left: Number(w.left || 0),
          top: Number(w.top || 0),
          width: Number(w.width || 420),
          height: Number(w.height || 320),
          z: Number(w.z || 0),
          collapsed: !!w.collapsed,
        });
      });

      if(data?.stage){
        if(typeof data.stage.minWidth === 'string') stage.style.minWidth = data.stage.minWidth;
        if(typeof data.stage.minHeight === 'string') stage.style.minHeight = data.stage.minHeight;
        stage.scrollLeft = Number(data.stage.scrollLeft || 0);
        stage.scrollTop  = Number(data.stage.scrollTop || 0);
      }

      recomputeStageBounds();
    }catch(err){
      console.warn('restore failed', err);
    }
  }

  // initial
  recomputeStageBounds();
  restoreIfPossible();
})();
