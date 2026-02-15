// Dropboard + Memomo v2 (non-module)
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const stage = $('#stage');
  const tpl = $('#winTpl');

  const fileInput = $('#fileInput');
  const loadInput = $('#loadInput');
  const toggleEditBtn = $('#toggleEditBtn');
  const toggleModeBtn = $('#toggleModeBtn');
  const saveBtn = $('#saveBtn');
  const printBtn = $('#printBtn');
  const printArea = $('#printArea');
  const memomoFooter = $('#memomoFooter');
  const clearBtn = $('#clearBtn');

  const memomoSidebar = $('#memomoSidebar');
  const thumbList = $('#thumbList');

  const dbPrevBtn = $('#dbPrevBtn');
  const dbNextBtn = $('#dbNextBtn');
  const dbAddPageBtn = $('#dbAddPageBtn');
  const dbPageLabel = $('#dbPageLabel');

  let editMode = true;

  // v5: smaller note minimums + per-mode notes
  const NOTE_MIN_W = 44;
  const NOTE_MIN_H = 28;
  const NOTE_MIN_N = 0.01;
  let mode = 'dropboard'; // 'dropboard' | 'memomo'

  let zCounter = 1000;
  const stateById = new Map();
  let activeWinId = null;

  const memomoState = {
    order: [],       // window id list
    activeId: null,  // active window id
  };

  // v7: Dropboard pages
  const dropboardState = {
    page: 0,
    pageCount: 1,
  };

  function hexToRgba(hex, a){
    let h = String(hex || "#ffffff").trim();
    if (h.startsWith("rgba") || h.startsWith("rgb")) return h;
    h = h.replace(/^#/, "");
    if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const rr = Number.isFinite(r) ? r : 255;
    const gg = Number.isFinite(g) ? g : 255;
    const bb = Number.isFinite(b) ? b : 255;
    const aa = (a === 0) ? 0 : (Number.isFinite(Number(a)) ? Number(a) : 1);
    return `rgba(${rr},${gg},${bb},${aa})`;
  }

  // IndexedDB
  const DB_NAME = 'dropboard';
  const DB_VER  = 1;
  const STORE   = 'kv';
  const KEY     = 'state_dropboard_memomo_v2';

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
    try{ await idbSet(KEY, data); }catch(err){ console.warn('persist failed', err); }
  }

  // utils
  function uid(){
    if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return 'id_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function isMemomo(){ return mode === 'memomo'; }

  function modeKey(){ return isMemomo() ? 'memomo' : 'dropboard'; }

  function ensureNotesSchema(st){
    if(!st) return;
    if(!st.notesByMode){
      st.notesByMode = {
        dropboard: Array.isArray(st.notes) ? st.notes : [],
        memomo: []
      };
    }else{
      st.notesByMode.dropboard = Array.isArray(st.notesByMode.dropboard) ? st.notesByMode.dropboard : [];
      st.notesByMode.memomo = Array.isArray(st.notesByMode.memomo) ? st.notesByMode.memomo : [];
    }
    if(!st.activeNoteIdByMode){
      st.activeNoteIdByMode = {
        dropboard: st.activeNoteId || null,
        memomo: null
      };
    }else{
      st.activeNoteIdByMode.dropboard = st.activeNoteIdByMode.dropboard || null;
      st.activeNoteIdByMode.memomo = st.activeNoteIdByMode.memomo || null;
    }
  }

  function getNotes(st){
    ensureNotesSchema(st);
    return st.notesByMode[modeKey()];
  }
  function getActiveNoteId(st){
    ensureNotesSchema(st);
    return st.activeNoteIdByMode[modeKey()] || null;
  }
  function setActiveNoteId(st, val){
    ensureNotesSchema(st);
    st.activeNoteIdByMode[modeKey()] = val || null;
  }

  function setEditMode(on){
    editMode = !!on;
    document.body.classList.toggle('is-edit', editMode);
    toggleEditBtn.setAttribute('aria-pressed', String(editMode));
    toggleEditBtn.textContent = `編集モード: ${editMode ? 'ON' : 'OFF'}`;
    // notes render changes (contenteditable, hover bar enable)
    $$('.win', stage).forEach(win => {
      updateNotePanel(win);
      renderNotes(win);
    });
    schedulePersist();
  }

  function setMode(next){
    const m = (next === 'memomo') ? 'memomo' : 'dropboard';
    if(mode === m) return;

    // before switching, sync dropboard layouts so they don't get overwritten by memomo layout
    syncAllDropboardLayouts();

    mode = m;
    document.body.classList.toggle('is-memomo', isMemomo());
    toggleModeBtn.textContent = `モード: ${isMemomo() ? 'Memomo' : 'Dropboard'}`;
    toggleModeBtn.setAttribute('aria-pressed', isMemomo() ? 'true' : 'false');

    if(isMemomo()){
      memomoSidebar.hidden = false;
      syncMemomoOrder();
      if(!memomoState.activeId){
        memomoState.activeId = activeWinId || memomoState.order[0] || null;
      }
      applyMemomoLayout();
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
      renderThumbs();
    }else{
      memomoSidebar.hidden = true;
      restoreDropboardLayoutToDOM();
      applyDropboardPage();
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
    }
    schedulePersist(250);
  }

  function bringToFront(win){
    zCounter += 1;
    win.style.zIndex = String(zCounter);
    const id = win.dataset.id;
    if(id) activeWinId = id;
    schedulePersist(350);
    if(!isMemomo()) syncDropboardLayout(win);
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
        throw new Error('HEIC/HEIF 変換ライブラリ（heic2any）が読み込めていません。オンラインで開いてください。');
      }
      const out = await conv({ blob: file, toType: 'image/png', quality: 0.92 });
      const blob = Array.isArray(out) ? out[0] : out;
      return await blobToDataURL(blob);
    }
    return await blobToDataURL(file);
  }

  // ---- model ----
  function ensureWinState(id){
    if(!stateById.has(id)){
      stateById.set(id, {
        title: 'image',
        dataURL: '',
        page: 0,
        // v5: notes separated by mode
        notesByMode: { dropboard: [], memomo: [] },
        activeNoteIdByMode: { dropboard: null, memomo: null },
        // legacy fields kept for migration
        notes: [],
        activeNoteId: null,
        // dropboard layout (persistent)
        layout: { left: 20, top: 20, width: 460, height: 340, z: 0, collapsed: false },
        // crop transform (persistent)
        crop: { on:false, nx: 0, ny: 0, nw: 1, nh: 1 },
      });
    }
    return stateById.get(id);
  }

  function syncDropboardLayout(win){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    const left = parseFloat(win.style.left || '0') || 0;
    const top  = parseFloat(win.style.top  || '0') || 0;
    const rect = win.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const z = parseInt(win.style.zIndex || '0', 10) || 0;
    const collapsed = win.classList.contains('is-collapsed');
    st.layout = { left, top, width, height, z, collapsed };
  }
  function syncAllDropboardLayouts(){
    if(isMemomo()) return;
    $$('.win', stage).forEach(syncDropboardLayout);
  }

  
  function computeDropboardPageCount(){
    let maxP = 0;
    stateById.forEach((st)=>{
      const p = Number(st.page ?? 0);
      if(Number.isFinite(p)) maxP = Math.max(maxP, p);
    });
    return Math.max(1, Number(dropboardState.pageCount || 1), maxP + 1);
  }

  function updateDropboardPagerUI(){
    dropboardState.pageCount = computeDropboardPageCount();
    dropboardState.page = clamp(Number(dropboardState.page || 0), 0, dropboardState.pageCount - 1);
    if(dbPageLabel) dbPageLabel.textContent = `${dropboardState.page + 1}/${dropboardState.pageCount}`;
    if(dbPrevBtn) dbPrevBtn.disabled = (dropboardState.page <= 0);
    if(dbNextBtn) dbNextBtn.disabled = (dropboardState.page >= dropboardState.pageCount - 1);
  }

  function applyDropboardPage(){
    if(isMemomo()) return;
    updateDropboardPagerUI();
    $$('.win', stage).forEach(win=>{
      const id = win.dataset.id;
      if(!id) return;
      const st = ensureWinState(id);
      const p = Number(st.page ?? 0);
      win.style.display = (p === dropboardState.page) ? '' : 'none';
    });
    recomputeStageBounds();
  }

  function setDropboardPage(p){
    dropboardState.pageCount = computeDropboardPageCount();
    dropboardState.page = clamp(Number(p || 0), 0, dropboardState.pageCount - 1);
    applyDropboardPage();
    schedulePersist(250);
  }

  function addDropboardPage(){
    dropboardState.pageCount = computeDropboardPageCount() + 1;
    dropboardState.page = dropboardState.pageCount - 1;
    applyDropboardPage();
    schedulePersist(250);
  }

  dbPrevBtn?.addEventListener('click', ()=> setDropboardPage(dropboardState.page - 1));
  dbNextBtn?.addEventListener('click', ()=> setDropboardPage(dropboardState.page + 1));
  dbAddPageBtn?.addEventListener('click', ()=> addDropboardPage());
function restoreDropboardLayoutToDOM(){
    $$('.win', stage).forEach(win=>{
      const id = win.dataset.id;
      if(!id) return;
      const st = ensureWinState(id);
      const L = st.layout || {};
      win.style.left = (Number(L.left||0)) + 'px';
      win.style.top  = (Number(L.top||0))  + 'px';
      win.style.width  = Math.max(260, Number(L.width||460)) + 'px';
      win.style.height = Math.max(220, Number(L.height||340)) + 'px';
      if(L.z) win.style.zIndex = String(L.z);
      win.classList.toggle('is-collapsed', !!L.collapsed);
      const btn = win.querySelector('[data-act="collapse"]');
      if(btn) btn.textContent = win.classList.contains('is-collapsed') ? '表示' : '非表示';

      // apply crop state too
      applyCropToDOM(win);
      // update image layout (contain box)
      updateImageLayout(win);
      renderNotes(win);
    });
  }

  // ---- stage bounds (dropboard only) ----
  function stageBaseMin(){
    const viewW = stage.clientWidth || window.innerWidth;
    const viewH = stage.clientHeight || window.innerHeight;
    return { w: Math.max(1200, Math.ceil(viewW * 1.4)), h: Math.max(900, Math.ceil(viewH * 1.4)) };
  }
  function recomputeStageBounds(){
    if(isMemomo()){
      stage.style.minWidth  = '';
      stage.style.minHeight = '';
      return;
    }
    const pad = 240;
    const base = stageBaseMin();
    let maxR = 0, maxB = 0;
    $$('.win', stage).forEach(win=>{
      if(win.style.display === 'none') return;
      const left = parseFloat(win.style.left || '0') || 0;
      const top  = parseFloat(win.style.top  || '0') || 0;
      maxR = Math.max(maxR, left + win.offsetWidth);
      maxB = Math.max(maxB, top + win.offsetHeight);
    });
    stage.style.minWidth  = Math.max(base.w, Math.ceil(maxR + pad)) + 'px';
    stage.style.minHeight = Math.max(base.h, Math.ceil(maxB + pad)) + 'px';
  }

  // ---- window collapse ----
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
      win.style.height = (isFinite(prevH) && prevH > 60 ? prevH : 340) + 'px';
      const prevMinH = win.dataset.prevMinH;
      win.style.minHeight = prevMinH || '';
      if(btn) btn.textContent = '非表示';
    }
    if(!isMemomo()) syncDropboardLayout(win);
    recomputeStageBounds();
    schedulePersist();
  }

  function setWindowTitle(win, title){
    const titleEl = $('.win__title', win);
    if (titleEl) titleEl.textContent = title || 'image';
  }

  function setWindowImageByDataURL(win, title, dataURL){
    const id = win.dataset.id;
    const img = $('.win__img', win);
    if(img){
      img.src = dataURL;
      img.alt = title || 'image';
    }
    setWindowTitle(win, title);
    if(id){
      const st = ensureWinState(id);
      st.title = title || 'image';
      st.dataURL = dataURL || '';
    }
    img?.addEventListener('load', ()=>{
      updateImageLayout(win);
      renderNotes(win);
      renderThumbs();
    }, { once:true });
    schedulePersist();
  }
  async function setWindowImageByFile(win, file){
    const dataURL = await fileToDataURL(file);
    setWindowImageByDataURL(win, file.name || 'image', dataURL);
  }

  // ---- image contain box + crop ----
  function updateImageLayout(win){
    const body = $('.win__body', win);
    const layer = $('.img-layer', win);
    const img = $('.win__img', win);
    if(!body || !layer || !img) return;

    const bw = body.clientWidth || 1;
    const bh = body.clientHeight || 1;

    const iw = img.naturalWidth || 0;
    const ih = img.naturalHeight || 0;

    // if no image loaded yet, center a default layer
    if(!iw || !ih){
      layer.style.width = Math.max(100, Math.floor(bw * 0.6)) + 'px';
      layer.style.height = Math.max(100, Math.floor(bh * 0.6)) + 'px';
      layer.style.left = Math.floor((bw - layer.offsetWidth)/2) + 'px';
      layer.style.top  = Math.floor((bh - layer.offsetHeight)/2) + 'px';
      return;
    }

    const s = Math.min(bw / iw, bh / ih);
    const w = Math.max(1, Math.floor(iw * s));
    const h = Math.max(1, Math.floor(ih * s));
    layer.style.width = w + 'px';
    layer.style.height = h + 'px';
    layer.style.left = Math.floor((bw - w) / 2) + 'px';
    layer.style.top  = Math.floor((bh - h) / 2) + 'px';

    applyCropToDOM(win);
  }

  
  function normalizeCrop(st){
    if(!st.crop || typeof st.crop !== 'object'){
      st.crop = { on:false, nx:0, ny:0, nw:1, nh:1 };
      return st.crop;
    }
    // legacy pan/zoom crop -> reset to full rectangle
    if(('s' in st.crop) || ('x' in st.crop) || ('y' in st.crop)){
      const on = !!st.crop.on;
      st.crop = { on, nx:0, ny:0, nw:1, nh:1 };
      return st.crop;
    }
    if(st.crop.on == null) st.crop.on = false;
    if(st.crop.nx == null) st.crop.nx = 0;
    if(st.crop.ny == null) st.crop.ny = 0;
    if(st.crop.nw == null) st.crop.nw = 1;
    if(st.crop.nh == null) st.crop.nh = 1;
    st.crop.nx = clamp(Number(st.crop.nx), 0, 1);
    st.crop.ny = clamp(Number(st.crop.ny), 0, 1);
    st.crop.nw = clamp(Number(st.crop.nw), 0.01, 1);
    st.crop.nh = clamp(Number(st.crop.nh), 0.01, 1);
    return st.crop;
  }

function applyCropToDOM(win){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    const layer = $('.img-layer', win);
    const body = $('.win__body', win);
    if(!layer || !body) return;

    const c = normalizeCrop(st);
    win.classList.toggle('is-crop', !!c.on);

    // default: full view
    let s = 1;
    let tx = 0;
    let ty = 0;

    const bw = body.clientWidth || 1;
    const bh = body.clientHeight || 1;
    const lw = layer.offsetWidth || 1;
    const lh = layer.offsetHeight || 1;

    // "crop mode" (c.on) is just for editing UI.
    // Even when crop mode is OFF, keep the last selection applied.
    const activeSel = (
      Math.abs((c.nx || 0)) > 0.0005 ||
      Math.abs((c.ny || 0)) > 0.0005 ||
      Math.abs((c.nw ?? 1) - 1) > 0.0005 ||
      Math.abs((c.nh ?? 1) - 1) > 0.0005
    );

    if(activeSel){
      // selection rect in layer coords
      const selW = clamp(c.nw, 0.01, 1) * lw;
      const selH = clamp(c.nh, 0.01, 1) * lh;

      // scale so selection fills the viewport (contain)
      s = clamp(Math.min(bw / selW, bh / selH), 1, 12);

      const cx = (c.nx + c.nw / 2) * lw;
      const cy = (c.ny + c.nh / 2) * lh;
      const dx = cx - lw / 2;
      const dy = cy - lh / 2;

      tx = -dx * s;
      ty = -dy * s;
    }

    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;

    // update header button label
    const btn = win.querySelector('[data-act="crop"]');
    if(btn) btn.textContent = c.on ? '切取ON' : '切取';
  }

  function toggleCrop(win){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    const c = normalizeCrop(st);
    c.on = !c.on;
    applyCropToDOM(win);
    schedulePersist(250);
  }

  function resetCrop(win){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    const c = normalizeCrop(st);
    // keep crop mode ON, just reset selection
    c.nx = 0; c.ny = 0; c.nw = 1; c.nh = 1;
    applyCropToDOM(win);
    schedulePersist(250);
  }

  // ---- notes ----
  function noteToPx(win, n){
    const layer = $('.img-layer', win);
    if(!layer) return { x:0, y:0, w:200, h:120 };
    const w = layer.offsetWidth || 1;
    const h = layer.offsetHeight || 1;
    return { x: (n.nx * w), y: (n.ny * h), w: (n.nw * w), h: (n.nh * h) };
  }
  function pxToNoteNorm(win, px){
    const layer = $('.img-layer', win);
    if(!layer) return { nx:0, ny:0, nw:0.3, nh:0.2 };
    const w = layer.offsetWidth || 1;
    const h = layer.offsetHeight || 1;
    return { nx: px.x / w, ny: px.y / h, nw: px.w / w, nh: px.h / h };
  }
  function applyNoteStyle(el, n){
    if(!el) return;
    el.style.background = hexToRgba(n.bg || "#ffffff", n.alpha ?? 0.85);
    el.style.color = n.fg || "#000000";
    el.style.fontSize = String(n.fs ?? 16) + "px";
    el.style.fontWeight = (n.bold ? "700" : "400");
  }
  function getActiveNote(win){
    const id = win.dataset.id;
    if(!id) return null;
    const st = ensureWinState(id);
    ensureNotesSchema(st);
    const nid = getActiveNoteId(st);
    if(!nid) return null;
    return getNotes(st).find(x => x.id === nid) || null;
  }
  function setActiveNote(win, noteId){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    ensureNotesSchema(st);
    const prev = getActiveNoteId(st);
    setActiveNoteId(st, noteId || null);
    const next = getActiveNoteId(st);
    if(prev && prev !== next){
      win.querySelector(`.note[data-id="${prev}"]`)?.classList.remove('active');
    }
    if(next){
      win.querySelector(`.note[data-id="${next}"]`)?.classList.add('active');
    }
    updateNotePanel(win);
    schedulePersist(300);
  }

  function updateNotePanel(win){
    const panel = $('.note-panel', win);
    if(!panel) return;
    const n = getActiveNote(win);
    if(!n || !editMode){
      panel.classList.remove('show');
      panel.setAttribute('aria-hidden', 'true');
      return;
    }
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');

    const bg = $('.npBg', panel);
    const fg = $('.npFg', panel);
    const alpha = $('.npAlpha', panel);
    const fs = $('.npFs', panel);
    const fsVal = $('.np-fsval', panel);
    const bold = $('.npBold', panel);
    const wIn = $('.npW', panel);
    const hIn = $('.npH', panel);

    if(bg) bg.value = n.bg || '#ffffff';
    if(fg) fg.value = n.fg || '#000000';
    if(alpha) alpha.value = String(n.alpha ?? 0.85);
    if(fs) fs.value = String(n.fs ?? 16);
    if(fsVal) fsVal.textContent = String(n.fs ?? 16);
    const px = noteToPx(win, n);
    if(wIn) wIn.value = String(Math.round(px.w));
    if(hIn) hIn.value = String(Math.round(px.h));
    if(bold){
      bold.classList.toggle('on', !!n.bold);
      bold.setAttribute('aria-pressed', n.bold ? 'true' : 'false');
    }
  }

  function trackPointer(downEvent, onMove, onUp){
    const pid = downEvent.pointerId;
    function move(ev){
      if(ev.pointerId !== pid) return;
      ev.preventDefault();
      onMove(ev);
    }
    function up(ev){
      if(ev.pointerId !== pid) return;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      onUp(ev);
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  }

  function bringNoteFront(win, noteId){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    ensureNotesSchema(st);
    const list = getNotes(st);
    const n = list.find(x => x.id === noteId);
    if(!n) return;
    const maxZ = Math.max(10, ...(list.map(x => x.z || 10)));
    n.z = maxZ + 1;
    win.querySelector(`.note[data-id="${noteId}"]`)?.style.setProperty('z-index', String(n.z));
    schedulePersist(250);
  }
  
  function deleteNote(win, noteId){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    ensureNotesSchema(st);
    const key = modeKey();
    st.notesByMode[key] = (st.notesByMode[key] || []).filter(x => x.id !== noteId);
    if(getActiveNoteId(st) === noteId) setActiveNoteId(st, null);
    renderNotes(win);
    schedulePersist(250);
  }


  function renderNotes(win){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    ensureNotesSchema(st);
    const layer = $('.notes-layer', win);
    if(!layer) return;

    layer.innerHTML = '';

    const list = getNotes(st);

    for(const n of list){
      if(n.bg == null) n.bg = '#ffffff';
      if(n.fg == null) n.fg = '#000000';
      if(n.alpha == null) n.alpha = 0.85;
      if(n.fs == null) n.fs = 16;
      if(n.bold == null) n.bold = false;
      if(n.v == null) n.v = 2;

      const px = noteToPx(win, n);

      const el = document.createElement('div');
      el.className = 'note';
      el.dataset.id = n.id;
      el.style.left = px.x + 'px';
      el.style.top  = px.y + 'px';
      el.style.width = Math.max(NOTE_MIN_W, px.w) + 'px';
      el.style.height = Math.max(NOTE_MIN_H, px.h) + 'px';
      el.style.zIndex = String(n.z || 20);

      applyNoteStyle(el, n);
      if(n.id === getActiveNoteId(st)) el.classList.add('active');

      const body = document.createElement('div');
      body.className = 'note-body';

      const editor = document.createElement('div');
      editor.className = 'note-editor';
      editor.setAttribute('contenteditable', 'false');
      editor.innerHTML = n.html || '';

      const startEditing = ()=>{
        if(!editMode) return;
        editor.setAttribute('contenteditable','true');
        el.classList.add('editing');
        setActiveNote(win, n.id);
        bringNoteFront(win, n.id);
        editor.focus();
        try{
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }catch{}
      };

      const stopEditing = ()=>{
        if(editor.getAttribute('contenteditable') !== 'true') return;
        editor.setAttribute('contenteditable','false');
        el.classList.remove('editing');
        n.html = editor.innerHTML;
        schedulePersist(250);
      };

      editor.addEventListener('dblclick', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        startEditing();
      });

      let lastTap = 0;
      editor.addEventListener('pointerup', (e)=>{
        if(e.pointerType !== 'touch') return;
        const now = Date.now();
        if(now - lastTap < 300){
          e.preventDefault();
          e.stopPropagation();
          startEditing();
          lastTap = 0;
        }else{
          lastTap = now;
        }
      }, { passive:false });

      editor.addEventListener('blur', ()=> stopEditing());
      editor.addEventListener('keydown', (e)=>{
        if(e.key === 'Escape'){
          e.preventDefault();
          editor.blur();
        }
      });

      editor.addEventListener('input', ()=>{
        if(editor.getAttribute('contenteditable') === 'true'){
          n.html = editor.innerHTML;
          schedulePersist(250);
        }
      });

      body.appendChild(editor);
      el.appendChild(body);

      const canDragFrom = (evt)=>{
        if(!editMode) return false;
        if(editor.getAttribute('contenteditable') === 'true') return false;
        if(evt.target.closest('.resizer')) return false;
                return true;
      };

      const startDrag = (startEvt)=>{
        setActiveNote(win, n.id);
        bringNoteFront(win, n.id);

        const startLeft = parseFloat(el.style.left) || px.x;
        const startTop  = parseFloat(el.style.top)  || px.y;
        const start = { x: startEvt.clientX, y: startEvt.clientY, left: startLeft, top: startTop };

        trackPointer(startEvt, (ev)=>{
          const nx = start.left + (ev.clientX - start.x);
          const ny = start.top  + (ev.clientY - start.y);
          el.style.left = nx + 'px';
          el.style.top  = ny + 'px';
        }, ()=>{
          const finalPx = {
            x: parseFloat(el.style.left) || 0,
            y: parseFloat(el.style.top)  || 0,
            w: parseFloat(el.style.width) || px.w,
            h: parseFloat(el.style.height)|| px.h
          };
          const norm = pxToNoteNorm(win, finalPx);
          n.nx = clamp(norm.nx, 0, 1);
          n.ny = clamp(norm.ny, 0, 1);
          n.nw = clamp(norm.nw, NOTE_MIN_N, 1);
          n.nh = clamp(norm.nh, NOTE_MIN_N, 1);
          schedulePersist(250);
        });
      };

      let lpTimer = null;
      let lpMoved = false;

      el.addEventListener('pointerdown', (e)=>{
        setActiveNote(win, n.id);
        if(!canDragFrom(e)) return;

        if(e.pointerType === 'touch' || e.pointerType === 'pen'){
          lpMoved = false;
          const sx = e.clientX, sy = e.clientY;

          lpTimer = setTimeout(()=>{
            lpTimer = null;
            if(lpMoved) return;
            startDrag(e);
          }, 260);

          const onMove = (ev)=>{
            if(Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 8){
              lpMoved = true;
              if(lpTimer){ clearTimeout(lpTimer); lpTimer = null; }
              el.removeEventListener('pointermove', onMove);
            }
          };
          el.addEventListener('pointermove', onMove, { passive:true });

          const cleanup = ()=>{
            if(lpTimer){ clearTimeout(lpTimer); lpTimer = null; }
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', cleanup);
            el.removeEventListener('pointercancel', cleanup);
          };
          el.addEventListener('pointerup', cleanup, { passive:true, once:true });
          el.addEventListener('pointercancel', cleanup, { passive:true, once:true });
        }else{
          if(e.button !== 0) return;

          // Mouse: start drag only after a tiny movement so dblclick-to-edit still works.
          const pid = e.pointerId;
          const sx = e.clientX, sy = e.clientY;
          const startLeft = parseFloat(el.style.left) || px.x;
          const startTop  = parseFloat(el.style.top)  || px.y;
          let dragging = false;

          function move(ev){
            if(ev.pointerId !== pid) return;
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;

            if(!dragging){
              if(Math.abs(dx) + Math.abs(dy) < 3) return;
              dragging = true;
              setActiveNote(win, n.id);
              bringNoteFront(win, n.id);
            }
            ev.preventDefault();
            el.style.left = (startLeft + dx) + 'px';
            el.style.top  = (startTop  + dy) + 'px';
          }
          function up(ev){
            if(ev.pointerId !== pid) return;
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', up, true);

            if(!dragging) return;

            const finalPx = {
              x: parseFloat(el.style.left) || 0,
              y: parseFloat(el.style.top)  || 0,
              w: parseFloat(el.style.width) || px.w,
              h: parseFloat(el.style.height)|| px.h
            };
            const norm = pxToNoteNorm(win, finalPx);
            n.nx = clamp(norm.nx, 0, 1);
            n.ny = clamp(norm.ny, 0, 1);
            n.nw = clamp(norm.nw, NOTE_MIN_N, 1);
            n.nh = clamp(norm.nh, NOTE_MIN_N, 1);
            schedulePersist(250);
          }
          document.addEventListener('pointermove', move, true);
          document.addEventListener('pointerup', up, true);
        }
      });

      if(editMode){
        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        resizer.addEventListener('pointerdown', (e)=>{
          if(e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          setActiveNote(win, n.id);
          bringNoteFront(win, n.id);

          const startW = parseFloat(el.style.width) || px.w;
          const startH = parseFloat(el.style.height)|| px.h;
          const start = { x: e.clientX, y: e.clientY, w: startW, h: startH };

          trackPointer(e, (ev)=>{
            const nw = Math.max(NOTE_MIN_W, start.w + (ev.clientX - start.x));
            const nh = Math.max(NOTE_MIN_H, start.h + (ev.clientY - start.y));
            el.style.width = nw + 'px';
            el.style.height= nh + 'px';
          }, ()=>{
            const finalPx = {
              x: parseFloat(el.style.left) || 0,
              y: parseFloat(el.style.top)  || 0,
              w: parseFloat(el.style.width)|| px.w,
              h: parseFloat(el.style.height)|| px.h
            };
            const norm = pxToNoteNorm(win, finalPx);
            n.nx = clamp(norm.nx, 0, 1);
            n.ny = clamp(norm.ny, 0, 1);
            n.nw = clamp(norm.nw, NOTE_MIN_N, 1);
            n.nh = clamp(norm.nh, NOTE_MIN_N, 1);
            schedulePersist(250);
          });
        });
        el.appendChild(resizer);
      }

      el.addEventListener('pointerdown', ()=> setActiveNote(win, n.id), { passive:true });

      layer.appendChild(el);
    }

    updateNotePanel(win);
  }

  function addNoteToWin(win){
    const id = win.dataset.id;
    if(!id) return;
    const st = ensureWinState(id);
    ensureNotesSchema(st);
    const n = {
      id: uid(),
      v: 2,
      nx: 0.08, ny: 0.10,
      nw: 0.22, nh: 0.16,
      html: 'メモ…',
      bg: '#ffffff', fg: '#000000',
      alpha: 0.85, fs: 16, bold: false,
      z: 20
    };
    const key = modeKey();
    st.notesByMode[key].push(n);
    setActiveNoteId(st, n.id);
    renderNotes(win);
    schedulePersist(250);
  }

  function wireNotePanel(win){
    const panel = $('.note-panel', win);
    if(!panel) return;

    const bg = $('.npBg', panel);
    const fg = $('.npFg', panel);
    const alpha = $('.npAlpha', panel);
    const fs = $('.npFs', panel);
    const fsVal = $('.np-fsval', panel);
    const bold = $('.npBold', panel);
    const wIn = $('.npW', panel);
    const hIn = $('.npH', panel);
    const del = $('.npDelete', panel);
    const clearSelBtn = panel.querySelector('[data-act="clearNoteSel"]');

    const apply = ()=>{
      const n = getActiveNote(win);
      if(!n) return;
      if(bg) n.bg = bg.value || n.bg;
      if(fg) n.fg = fg.value || n.fg;
      if(alpha) n.alpha = Number(alpha.value);
      if(fs) n.fs = Number(fs.value);
      if(fsVal) fsVal.textContent = String(n.fs || 16);
      applyNoteStyle(win.querySelector(`.note[data-id="${n.id}"]`), n);
      schedulePersist(200);
    };

    bg?.addEventListener('input', apply);
    fg?.addEventListener('input', apply);
    alpha?.addEventListener('input', apply);
    fs?.addEventListener('input', apply);

    const applyWH = ()=>{
      const n = getActiveNote(win);
      if(!n) return;
      const cur = noteToPx(win, n);
      const wpx = wIn ? Number(wIn.value) : cur.w;
      const hpx = hIn ? Number(hIn.value) : cur.h;
      if(Number.isFinite(wpx)) cur.w = wpx;
      if(Number.isFinite(hpx)) cur.h = hpx;
      cur.w = Math.max(NOTE_MIN_W, cur.w);
      cur.h = Math.max(NOTE_MIN_H, cur.h);
      const norm = pxToNoteNorm(win, cur);
      n.nw = clamp(norm.nw, NOTE_MIN_N, 1);
      n.nh = clamp(norm.nh, NOTE_MIN_N, 1);
      const el = win.querySelector(`.note[data-id="${n.id}"]`);
      if(el){
        el.style.width  = Math.max(NOTE_MIN_W, cur.w) + 'px';
        el.style.height = Math.max(NOTE_MIN_H, cur.h) + 'px';
      }
      schedulePersist(200);
    };

    wIn?.addEventListener('input', applyWH);
    hIn?.addEventListener('input', applyWH);

    const attachNumberDrag = (inputEl)=>{
      if(!inputEl) return;
      inputEl.addEventListener('pointerdown', (e)=>{
        if(e.pointerType !== 'mouse') return;
        if(e.button !== 0) return;

        const pid = e.pointerId;
        const sx = e.clientX;
        const startVal = Number(inputEl.value) || 0;
        let dragging = false;

        function move(ev){
          if(ev.pointerId !== pid) return;
          const dx = ev.clientX - sx;
          if(!dragging){
            if(Math.abs(dx) < 3) return;
            dragging = true;
          }
          ev.preventDefault();
          const nv = Math.max(0, Math.round(startVal + dx * 0.7));
          inputEl.value = String(nv);
          applyWH();
        }
        function up(ev){
          if(ev.pointerId !== pid) return;
          document.removeEventListener('pointermove', move, true);
          document.removeEventListener('pointerup', up, true);
        }
        document.addEventListener('pointermove', move, true);
        document.addEventListener('pointerup', up, true);
      });
    };
    attachNumberDrag(wIn);
    attachNumberDrag(hIn);

    bold?.addEventListener('click', ()=>{
      const n = getActiveNote(win);
      if(!n) return;
      n.bold = !n.bold;
      renderNotes(win);
      schedulePersist(200);
    });

    del?.addEventListener('click', ()=>{
      const n = getActiveNote(win);
      if(!n) return;
      deleteNote(win, n.id);
    });

    clearSelBtn?.addEventListener('click', ()=>{
      setActiveNote(win, null);
    });
  }

  // ---- window events ----
  const resizeObserver = new ResizeObserver((entries)=>{
    for(const ent of entries){
      const win = ent.target;
      if(!(win instanceof HTMLElement)) continue;
      if(win.classList.contains('is-collapsed')){
        const header = win.querySelector('.win__header');
        const hh = (header?.offsetHeight || 38);
        win.style.height = hh + 'px';
        win.style.minHeight = hh + 'px';
      }else{
        updateImageLayout(win);
        renderNotes(win);
      }
      if(!isMemomo()) syncDropboardLayout(win);
    }
    recomputeStageBounds();
    schedulePersist(700);
    if(isMemomo()) applyMemomoLayout();
  });

  const drag = { active:false, win:null, pid:null, startX:0, startY:0, startL:0, startT:0 };
  const cropDrag = { active:false, win:null, pid:null, startX:0, startY:0, startCX:0, startCY:0 };

  function attachWindowEvents(win){
    const header = $('.win__header', win);
    const wrap = $('.img-wrap', win);
    const titleEl = $('.win__title', win);

    // --- title edit (double click) ---
    function beginTitleEdit(){
      if(!titleEl) return;
      if(win.classList.contains('is-title-editing')) return;

      const id = win.dataset.id;
      const st = id ? ensureWinState(id) : null;
      const current = String((st && st.title) ? st.title : (titleEl.textContent || '')).trim() || 'image';

      win.classList.add('is-title-editing');
      titleEl.innerHTML = '';

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'win__title-input';
      inp.value = current;
      inp.spellcheck = false;
      inp.autocomplete = 'off';

      const commit = (cancel=false)=>{
        if(!win.classList.contains('is-title-editing')) return;
        win.classList.remove('is-title-editing');

        const v = cancel ? current : String(inp.value || '').trim();
        const newTitle = v || 'image';

        if(st) st.title = newTitle;
        setWindowTitle(win, newTitle);

        const img = $('.win__img', win);
        if(img) img.alt = newTitle;

        renderThumbs();        // no-op if hidden
        schedulePersist(250);
      };

      inp.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); });
      inp.addEventListener('dblclick', (e)=>{ e.stopPropagation(); });
      inp.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter'){
          e.preventDefault();
          inp.blur();
        }else if(e.key === 'Escape'){
          e.preventDefault();
          commit(true);
        }
      });
      inp.addEventListener('blur', ()=> commit(false));

      titleEl.appendChild(inp);
      inp.focus();
      inp.select();
    }

    titleEl?.addEventListener('dblclick', (e)=>{
      e.stopPropagation();
      e.preventDefault();
      beginTitleEdit();
    });

    win.addEventListener('pointerdown', ()=>{
      bringToFront(win);
    });

    header?.addEventListener('pointerdown', (e)=>{
      if(!editMode) return;
      if(isMemomo()) return;
      if(e.target.closest('button')) return;
      if(e.target.closest('.win__title')) return;
      if(win.classList.contains('is-title-editing')) return;
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
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
      schedulePersist(600);
    });

    function endDrag(e){
      if(!drag.active) return;
      if(e && drag.pid !== e.pointerId) return;
      if(drag.win) drag.win.classList.remove('is-dragging');
      drag.active = false;
      const w = drag.win;
      drag.win = null;
      drag.pid = null;
      if(w) syncDropboardLayout(w);
      schedulePersist(250);
    }
    header?.addEventListener('pointerup', endDrag);
    header?.addEventListener('pointercancel', endDrag);

    win.addEventListener('click', (e)=>{
      const act = e.target?.closest?.('button')?.dataset?.act;
      if(!act) return;
      if(act === 'delete'){
        removeWindow(win);
      }else if(act === 'collapse'){
        setCollapsed(win, !win.classList.contains('is-collapsed'));
      }else if(act === 'addnote'){
        addNoteToWin(win);
      }else if(act === 'crop'){
        toggleCrop(win);
      }
    });

    header?.addEventListener('dblclick', (e)=>{
      if(e.target.closest('button')) return;
      if(e.target.closest('.win__title')) return;
      setCollapsed(win, !win.classList.contains('is-collapsed'));
    });

    // crop interactions (v8: drag select rectangle)
    const ensureCropRectEl = ()=>{
      let r = win.querySelector('.crop-rect');
      if(!r){
        r = document.createElement('div');
        r.className = 'crop-rect';
        r.style.display = 'none';
        wrap?.appendChild(r);
      }
      return r;
    };

    wrap?.addEventListener('dblclick', ()=>{
      if(!editMode) return;
      if(!win.classList.contains('is-crop')) return;
      resetCrop(win);
    });

    const sel = { active:false, pid:null, x0:0, y0:0, rect:null };

    wrap?.addEventListener('pointerdown', (e)=>{
      if(!editMode) return;
      if(!win.classList.contains('is-crop')) return;
      if(e.button !== 0) return;
      if(e.target.closest('.note') || e.target.closest('.note-panel') || e.target.closest('.drop-overlay')) return;

      const id = win.dataset.id;
      if(!id) return;
      const st = ensureWinState(id);
      const c = normalizeCrop(st);
      if(!c.on) return;

      e.preventDefault();
      sel.active = true;
      sel.pid = e.pointerId;
      sel.rect = ensureCropRectEl();

      const wrapRect = wrap.getBoundingClientRect();
      sel.x0 = clamp(e.clientX - wrapRect.left, 0, wrapRect.width);
      sel.y0 = clamp(e.clientY - wrapRect.top, 0, wrapRect.height);

      if(sel.rect){
        sel.rect.style.display = 'block';
        sel.rect.style.left = sel.x0 + 'px';
        sel.rect.style.top = sel.y0 + 'px';
        sel.rect.style.width = '0px';
        sel.rect.style.height= '0px';
      }
      wrap.setPointerCapture(e.pointerId);
    });

    wrap?.addEventListener('pointermove', (e)=>{
      if(!sel.active || sel.pid !== e.pointerId) return;
      const wrapRect = wrap.getBoundingClientRect();
      const x1 = clamp(e.clientX - wrapRect.left, 0, wrapRect.width);
      const y1 = clamp(e.clientY - wrapRect.top, 0, wrapRect.height);

      const x = Math.min(sel.x0, x1);
      const y = Math.min(sel.y0, y1);
      const w = Math.abs(x1 - sel.x0);
      const h = Math.abs(y1 - sel.y0);

      if(sel.rect){
        sel.rect.style.left = x + 'px';
        sel.rect.style.top  = y + 'px';
        sel.rect.style.width = w + 'px';
        sel.rect.style.height= h + 'px';
      }
    });

    function endSel(e){
      if(!sel.active) return;
      if(e && sel.pid !== e.pointerId) return;

      const x0 = sel.x0;
      const y0 = sel.y0;

      const rectEl = sel.rect;
      sel.active = false;
      sel.pid = null;
      if(rectEl) rectEl.style.display = 'none';

      const id = win.dataset.id;
      if(!id) return;
      const st = ensureWinState(id);
      const c = normalizeCrop(st);
      if(!c.on) return;

      if(!wrap) return;
      const wrapRect = wrap.getBoundingClientRect();
      const x1 = clamp((e ? e.clientX : wrapRect.left) - wrapRect.left, 0, wrapRect.width);
      const y1 = clamp((e ? e.clientY : wrapRect.top) - wrapRect.top, 0, wrapRect.height);

      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);

      if(w < 8 || h < 8){
        schedulePersist(120);
        return;
      }

      const layer = $('.img-layer', win);
      if(!layer) return;
      const layerRect = layer.getBoundingClientRect();

      // selection rect in client space
      const selClientLeft = wrapRect.left + x;
      const selClientTop  = wrapRect.top + y;
      const selClientRight = selClientLeft + w;
      const selClientBottom= selClientTop + h;

      // intersect with layer bounds
      const ix0 = clamp(selClientLeft - layerRect.left, 0, layerRect.width);
      const iy0 = clamp(selClientTop  - layerRect.top,  0, layerRect.height);
      const ix1 = clamp(selClientRight - layerRect.left, 0, layerRect.width);
      const iy1 = clamp(selClientBottom- layerRect.top,  0, layerRect.height);

      const iw = Math.max(1, ix1 - ix0);
      const ih = Math.max(1, iy1 - iy0);

      c.nx = clamp(ix0 / layerRect.width, 0, 1);
      c.ny = clamp(iy0 / layerRect.height, 0, 1);
      c.nw = clamp(iw / layerRect.width, 0.01, 1);
      c.nh = clamp(ih / layerRect.height, 0.01, 1);

      applyCropToDOM(win);
      schedulePersist(250);
    }
    wrap?.addEventListener('pointerup', endSel);
    wrap?.addEventListener('pointercancel', endSel);

    // DnD overlay per window
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

  function createWindow({
    id = uid(),
    title = 'image',
    dataURL = '',
    left = 20,
    top = 20,
    width = 460,
    height = 340,
    z = null,
    collapsed = false,
    page = null,
    notesByMode = null,
    activeNoteIdByMode = null,
    // legacy
    notes = [],
    activeNoteId = null,
    crop = null,
  } = {}){
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = id;

    node.style.left = Math.max(0, left) + 'px';
    node.style.top = Math.max(0, top) + 'px';
    node.style.width = Math.max(260, width) + 'px';
    node.style.height = Math.max(220, height) + 'px';

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
      img.setAttribute('draggable','false');
      img.addEventListener('dragstart', (e)=> e.preventDefault());
      img.addEventListener('load', ()=>{
        updateImageLayout(node);
        renderNotes(node);
        renderThumbs();
      }, { once:true });
    }

    const st = ensureWinState(id);
    st.title = title || 'image';
    st.dataURL = dataURL || '';

// page (dropboard)
// NOTE: If we don't store st.page here, every window keeps the default page=0 and will end up on page 1.
const pn = (page !== null && page !== undefined) ? Number(page) : NaN;
if(Number.isFinite(pn)){
  st.page = Math.max(0, Math.floor(pn));
}else if(st.page == null){
  st.page = Math.max(0, Math.floor(Number(dropboardState.page || 0)));
}
    // notes (v5)
    st.notes = Array.isArray(notes) ? notes : [];
    st.activeNoteId = activeNoteId || null;

    if(notesByMode && typeof notesByMode === 'object'){
      st.notesByMode = {
        dropboard: Array.isArray(notesByMode.dropboard) ? notesByMode.dropboard : (Array.isArray(notes) ? notes : []),
        memomo: Array.isArray(notesByMode.memomo) ? notesByMode.memomo : [],
      };
    }
    if(activeNoteIdByMode && typeof activeNoteIdByMode === 'object'){
      st.activeNoteIdByMode = {
        dropboard: activeNoteIdByMode.dropboard || (activeNoteId || null),
        memomo: activeNoteIdByMode.memomo || null,
      };
    }
    ensureNotesSchema(st);

    // layout (dropboard)
    st.layout = { left, top, width, height, z: Number(node.style.zIndex||0), collapsed: !!collapsed };

    // crop
    if(crop && typeof crop === 'object'){
      st.crop = {
        on: !!crop.on,
        s: clamp(Number(crop.s || 1), 1, 6),
        x: Number(crop.x || 0),
        y: Number(crop.y || 0),
      };
    }
    applyCropToDOM(node);

    attachWindowEvents(node);
    wireNotePanel(node);
    stage.appendChild(node);

    // show only on its assigned page (dropboard)
    if(!isMemomo()){
      const p = Number(st.page ?? 0);
      node.style.display = (p === Number(dropboardState.page || 0)) ? '' : 'none';
    }

    if(collapsed) setCollapsed(node, true);

    resizeObserver.observe(node);
    updateImageLayout(node);
    recomputeStageBounds();
    renderNotes(node);

    syncMemomoOrder();
    renderThumbs();

    return node;
  }

  function removeWindow(win){
    const id = win.dataset.id;
    resizeObserver.unobserve(win);
    win.remove();
    if(id) stateById.delete(id);

    // remove from memomo order
    memomoState.order = memomoState.order.filter(x => x !== id);
    if(memomoState.activeId === id){
      memomoState.activeId = memomoState.order[0] || null;
    }
    renderThumbs();
    if(isMemomo()) applyMemomoLayout();

    recomputeStageBounds();
    schedulePersist();
  }

  // UI: add images
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
      try{ dataURL = await fileToDataURL(f); }
      catch(err){ alert(String(err?.message || err || '画像の読み込みに失敗しました')); continue; }

      const win = createWindow({
        title: f.name || 'image',
        dataURL,
        page: dropboardState.page,
        left: baseLeft + i*offset,
        top: baseTop + i*offset,
        width: 520,
        height: 380,
        collapsed: false
      });
      bringToFront(win);
    }
    schedulePersist();
    if(isMemomo()){
      syncMemomoOrder();
      if(!memomoState.activeId) memomoState.activeId = memomoState.order[0] || null;
      applyMemomoLayout();
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
      renderThumbs();
    }
  });

  toggleEditBtn.addEventListener('click', ()=> setEditMode(!editMode));
  toggleModeBtn.addEventListener('click', ()=> setMode(isMemomo() ? 'dropboard' : 'memomo'));

  window.addEventListener('keydown', (e)=>{
    // mode switch (Ctrl/Cmd+M)
    if(e.key?.toLowerCase() === 'm' && (e.ctrlKey || e.metaKey)){
      e.preventDefault();
      setMode(isMemomo() ? 'dropboard' : 'memomo');
      return;
    }
    // edit switch (Ctrl/Cmd+E)
    if(e.key?.toLowerCase() === 'e' && (e.ctrlKey || e.metaKey)){
      e.preventDefault();
      setEditMode(!editMode);
      return;
    }

    // memomo navigation
    if(isMemomo()){
      if(e.key === 'ArrowRight' || e.key === 'PageDown'){
        e.preventDefault();
        stepMemomo(+1);
        return;
      }
      if(e.key === 'ArrowLeft' || e.key === 'PageUp'){
        e.preventDefault();
        stepMemomo(-1);
        return;
      }
    }

    // add note (N)
    if(e.key?.toLowerCase() === 'n' && editMode){
      const a = document.activeElement;
      if(a && a.classList?.contains('note-editor')) return;
      const win = getActiveWin();
      if(win) addNoteToWin(win);
    }
  });

  function getActiveWin(){
    const id = isMemomo() ? memomoState.activeId : activeWinId;
    return id ? stage.querySelector(`.win[data-id="${id}"]`) : null;
  }

  // ---- Memomo sidebar ----
  function syncMemomoOrder(){
    const idsInDOM = $$('.win', stage).map(w => w.dataset.id).filter(Boolean);
    const set = new Set(idsInDOM);

    // prune removed
    memomoState.order = (memomoState.order || []).filter(id => set.has(id));

    // append missing (keep existing order)
    for(const id of idsInDOM){
      if(!memomoState.order.includes(id)) memomoState.order.push(id);
    }

    if(memomoState.activeId && !set.has(memomoState.activeId)){
      memomoState.activeId = memomoState.order[0] || null;
    }
  }
  function renderThumbs(){
    if(memomoSidebar.hidden) return;
    syncMemomoOrder();
    const ids = memomoState.order.slice();
    thumbList.innerHTML = '';

    for(const id of ids){
      const st = ensureWinState(id);
      const el = document.createElement('div');
      el.className = 'thumb';
      el.setAttribute('role','listitem');
      if(id === memomoState.activeId) el.classList.add('active');

      const img = document.createElement('img');
      img.className = 'thumb__img';
      img.src = st.dataURL || '';
      img.alt = st.title || 'image';

      const cap = document.createElement('div');
      cap.className = 'thumb__cap';
      cap.textContent = st.title || 'image';

      el.appendChild(img);
      el.appendChild(cap);

      el.addEventListener('click', ()=>{
        memomoState.activeId = id;
        applyMemomoLayout();
        renderThumbs();
        schedulePersist(250);
      });

      thumbList.appendChild(el);
    }
  }
  function stepMemomo(dir){
    syncMemomoOrder();
    if(memomoState.order.length === 0) return;
    const cur = memomoState.activeId || memomoState.order[0];
    const idx = memomoState.order.indexOf(cur);
    const next = memomoState.order[(idx + dir + memomoState.order.length) % memomoState.order.length];
    memomoState.activeId = next;
    applyMemomoLayout();
    renderThumbs();
    schedulePersist(250);
  }
  function applyMemomoLayout(){
    if(!isMemomo()) return;
    syncMemomoOrder();
    const active = memomoState.activeId || memomoState.order[0] || null;
    memomoState.activeId = active;

    const mainW = stage.clientWidth || 1;
    const mainH = stage.clientHeight || 1;
    const sidebarW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebarW')) || 220;

    const pad = 12;
    const w = Math.max(260, Math.floor(mainW - sidebarW - pad*3 - 10));
    const h = Math.max(220, Math.floor(mainH - pad*2));

    $$('.win', stage).forEach(win=>{
      const id = win.dataset.id;
      if(id !== active){
        win.style.display = 'none';
        return;
      }
      win.style.display = '';
      win.style.left = pad + 'px';
      win.style.top  = pad + 'px';
      win.style.width = w + 'px';
      win.style.height = h + 'px';
      // memomo always expanded
      if(win.classList.contains('is-collapsed')){
        setCollapsed(win, false);
      }
      bringToFront(win);
      updateImageLayout(win);
      renderNotes(win);
    });

    renderThumbs();
  }

  // ---- export/import ----
  function buildExport(){
    // Always export dropboard layout from st.layout, NOT the current DOM (memomo overwrites DOM)
    const wins = $$('.win', stage).map(win=>{
      const id = win.dataset.id || uid();
      const st = ensureWinState(id);
      const L = st.layout || {};
      return {
        id,
        title: st.title,
        dataURL: st.dataURL,
        left: Number(L.left || 0),
        top: Number(L.top || 0),
        width: Number(L.width || 460),
        height: Number(L.height || 340),
        z: Number(L.z || 0),
        collapsed: !!L.collapsed,
        page: Number(st.page ?? 0),
        notesByMode: st.notesByMode || { dropboard: (st.notes || []), memomo: [] },
        activeNoteIdByMode: st.activeNoteIdByMode || { dropboard: (st.activeNoteId || null), memomo: null },
        // legacy
        notes: st.notes || [],
        activeNoteId: st.activeNoteId || null,
        crop: st.crop || { on:false, s:1, x:0, y:0 },
      };
    });

    return {
      app: 'dropboard',
      version: 4,
      exportedAt: new Date().toISOString(),
      mode,
      editMode,
      zCounter,
      memomo: {
        order: memomoState.order || [],
        activeId: memomoState.activeId || null,
      },
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
    const name = `dropboard_memomo_${ts.getFullYear()}${pad2(ts.getMonth()+1)}${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}.json`;
    downloadText(name, JSON.stringify(data, null, 2));
  });

  function buildPrintArea(){
    if(!printArea) return;
    printArea.innerHTML = '';
    printArea.hidden = false;
    // Make printArea measurable in screen media (kept invisible & off-interaction).
    // This prevents 0-size measurements before the print preview switches media.
    printArea.style.display = 'block';
    printArea.style.position = 'fixed';
    printArea.style.left = '0';
    printArea.style.top = '0';
    printArea.style.opacity = '0';
    printArea.style.pointerEvents = 'none';
    printArea.style.zIndex = '-1';


    const wins = [];
    if(isMemomo()){
      syncMemomoOrder();
      const order = (memomoState.order && memomoState.order.length) ? memomoState.order.slice() : [];
      if(order.length){
        order.forEach((id)=>{
          const w = stage.querySelector(`.win[data-id="${id}"]`);
          if(w) wins.push(w);
        });
      }else{
        $$('.win', stage).forEach(w=> wins.push(w));
      }
    }else{
      $$('.win', stage).forEach(w=>{
        if(w.style.display === 'none') return;
        wins.push(w);
      });
    }

    wins.forEach((w)=>{
      const wrap = document.createElement('div');
      wrap.className = 'print-item';

      const frame = document.createElement('div');
      frame.className = 'print-frame';

      const clone = w.cloneNode(true);
      clone.classList.remove('is-collapsed');
      clone.classList.remove('is-dragging');

      // remove interactive-only overlays
      clone.querySelectorAll('.drop-overlay,.note-panel,.crop-hint,.resizer').forEach(x=> x.remove());
      const act = clone.querySelector('.win__actions');
      if(act) act.remove();

      // make it static
      clone.style.left = '0px';
      clone.style.top  = '0px';
      clone.style.zIndex = '0';
      clone.style.transform = 'none';
      clone.style.position = 'absolute';
      clone.style.pointerEvents = 'none';
      clone.querySelectorAll('*').forEach(n=>{ n.style && (n.style.pointerEvents = 'none'); });

      frame.appendChild(clone);
      wrap.appendChild(frame);
      printArea.appendChild(wrap);
    });

    // after DOM paint: update image layout and fit-to-page scaling
    requestAnimationFrame(()=>{
      $$('.print-item', printArea).forEach((item)=>{
        const frame = item.querySelector('.print-frame');
        const winEl = item.querySelector('.win');
        if(!frame || !winEl) return;

        // ensure layer is correctly sized in print clone
        try{
          updateImageLayout(winEl);
          renderNotes(winEl);
          applyCropToDOM(winEl);
        }catch{}

        // fit window into frame
        const fr = frame.getBoundingClientRect();
        const fw = fr.width || 1;
        const fh = fr.height || 1;

        // clear any previous scaling
        winEl.style.transform = 'none';
        const ww = winEl.offsetWidth || 460;
        const wh = winEl.offsetHeight || 340;

        const s = Math.min(fw / ww, fh / wh, 1);
        const ox = (fw - ww * s) / 2;
        const oy = (fh - wh * s) / 2;

        winEl.style.transformOrigin = 'top left';
        winEl.style.transform = `scale(${s})`;
        winEl.style.left = Math.max(0, ox) + 'px';
        winEl.style.top  = Math.max(0, oy) + 'px';
      });
    });
  }

  if(printBtn){
    printBtn.addEventListener('click', ()=>{
      buildPrintArea();
      requestAnimationFrame(()=> requestAnimationFrame(()=> window.print()));
    });
  }

  window.addEventListener('afterprint', ()=>{
    if(printArea){
      printArea.innerHTML = '';
      printArea.hidden = true;
      printArea.removeAttribute('style');
    }
  });

  function clearAll({persist=true} = {}){
    $$('.win', stage).forEach(w=>{ resizeObserver.unobserve(w); w.remove(); });
    stateById.clear();
    zCounter = 1000;
    activeWinId = null;
    memomoState.order = [];
    memomoState.activeId = null;
    dropboardState.page = 0;
    dropboardState.pageCount = 1;
    recomputeStageBounds();
    if(persist) schedulePersist();
    renderThumbs();
  }

  loadInput.addEventListener('change', async ()=>{
    const f = loadInput.files?.[0];
    loadInput.value = '';
    if(!f) return;
    const text = await f.text().catch(()=> '');
    if(!text) return;

    let data = null;
    try{ data = JSON.parse(text); }
    catch{ alert('JSONの読み込みに失敗しました（形式が不正です）'); return; }

    if(!data || !Array.isArray(data.windows)){
      alert('このJSONはDropboard形式ではないようです。');
      return;
    }

    clearAll({persist:false});

    // restore top-level states
    editMode = !!(data.editMode ?? true);
    zCounter = Number(data.zCounter || 1000) || 1000;

    // memomo state
    if(data.memomo){
      memomoState.order = Array.isArray(data.memomo.order) ? data.memomo.order.slice() : [];
      memomoState.activeId = data.memomo.activeId || null;
    }

    // dropboard pages
    if(data.dropboard){
      dropboardState.page = Number(data.dropboard.page || 0) || 0;
      dropboardState.pageCount = Number(data.dropboard.pageCount || 1) || 1;
    }

    // windows
    (data.windows || []).forEach(w=>{
      createWindow({
        id: w.id || uid(),
        title: w.title || 'image',
        dataURL: w.dataURL || '',
        left: Number(w.left || 0),
        top: Number(w.top || 0),
        width: Number(w.width || 460),
        height: Number(w.height || 340),
        z: Number(w.z || 0),
        collapsed: !!w.collapsed,
        page: (w.page !== undefined ? Number(w.page||0) : 0),
        notesByMode: (w.notesByMode && typeof w.notesByMode === 'object') ? w.notesByMode : null,
        activeNoteIdByMode: (w.activeNoteIdByMode && typeof w.activeNoteIdByMode === 'object') ? w.activeNoteIdByMode : null,
        notes: Array.isArray(w.notes) ? w.notes : [],
        activeNoteId: w.activeNoteId || null,
        crop: w.crop || null,
      });
    });

    // stage
    if(data?.stage){
      if(typeof data.stage.minWidth === 'string') stage.style.minWidth = data.stage.minWidth;
      if(typeof data.stage.minHeight === 'string') stage.style.minHeight = data.stage.minHeight;
      stage.scrollLeft = Number(data.stage.scrollLeft || 0);
      stage.scrollTop  = Number(data.stage.scrollTop || 0);
    }

    // mode last
    setEditMode(editMode);
    setMode(data.mode === 'memomo' ? 'memomo' : 'dropboard');

    if(!isMemomo()){
      restoreDropboardLayoutToDOM();
      applyDropboardPage();
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
    }else{
      applyMemomoLayout();
    }

    schedulePersist(150);
  });

  clearBtn.addEventListener('click', async ()=>{
    const ok = confirm('画像ウィンドウをすべて削除します。よろしいですか？（付箋も消えます）');
    if(!ok) return;
    clearAll({persist:false});
    try{ await idbDel(KEY); }catch{}
  });

  // DnD anywhere
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
    return { x: (clientX - stageRect.left) + stage.scrollLeft, y: (clientY - stageRect.top) + stage.scrollTop };
  }
  async function handleDropEvent(e){
    const files = Array.from(e.dataTransfer?.files || []).filter(isImageFile);
    if(files.length === 0) return;

    const win = e.target?.closest?.('.win') || null;
    const { x: dropX, y: dropY } = getStageCoordsFromClient(e.clientX, e.clientY);

    if(win){
      bringToFront(win);
      try{ await setWindowImageByFile(win, files[0]); }
      catch(err){ alert(String(err?.message || err || '画像の読み込みに失敗しました')); return; }

      // other files -> new windows (dropboard) or add to memomo order
      for(let i=1;i<files.length;i++){
        const f = files[i];
        let dataURL = '';
        try{ dataURL = await fileToDataURL(f); }
        catch(err){ alert(String(err?.message || err || '画像の読み込みに失敗しました')); continue; }

        createWindow({
        title: f.name || 'image',
        dataURL,
        page: dropboardState.page, left: dropX + i*24, top: dropY + i*24, width: 520, height: 380 });
      }
      schedulePersist();
      if(isMemomo()){
        syncMemomoOrder();
        applyMemomoLayout();
        renderThumbs();
      }
      return;
    }

    for(let i=0;i<files.length;i++){
      const f = files[i];
      let dataURL = '';
      try{ dataURL = await fileToDataURL(f); }
      catch(err){ alert(String(err?.message || err || '画像の読み込みに失敗しました')); continue; }

      createWindow({
        title: f.name || 'image',
        dataURL,
        page: dropboardState.page, left: dropX + i*24, top: dropY + i*24, width: 520, height: 380 });
    }
    schedulePersist();
    if(isMemomo()){
      syncMemomoOrder();
      if(!memomoState.activeId) memomoState.activeId = memomoState.order[0] || null;
      applyMemomoLayout();
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
      renderThumbs();
    }
  }

  let dragDepth = 0;
  function setDragging(on){ document.body.classList.toggle('is-dragging-files', !!on); }

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

  // stage scroll persists only in dropboard
  stage.addEventListener('scroll', ()=>{
    if(isMemomo()) return;
    schedulePersist(800);
  }, { passive:true });

  // bootstrap restore
  async function restoreIfPossible(){
    try{
      const data = await idbGet(KEY);
      if(!data || !Array.isArray(data.windows)) return;

      clearAll({persist:false});

      editMode = !!(data.editMode ?? true);
      zCounter = Number(data.zCounter || 1000) || 1000;

      if(data.memomo){
        memomoState.order = Array.isArray(data.memomo.order) ? data.memomo.order.slice() : [];
        memomoState.activeId = data.memomo.activeId || null;
      }

      if(data.dropboard){
        dropboardState.page = Number(data.dropboard.page || 0) || 0;
        dropboardState.pageCount = Number(data.dropboard.pageCount || 1) || 1;
      }

      (data.windows || []).forEach(w=>{
        createWindow({
          id: w.id || uid(),
          title: w.title || 'image',
          dataURL: w.dataURL || '',
          left: Number(w.left || 0),
          top: Number(w.top || 0),
          width: Number(w.width || 460),
          height: Number(w.height || 340),
          z: Number(w.z || 0),
          collapsed: !!w.collapsed,
          page: (w.page !== undefined ? Number(w.page||0) : 0),
          notesByMode: (w.notesByMode && typeof w.notesByMode === 'object') ? w.notesByMode : null,
          activeNoteIdByMode: (w.activeNoteIdByMode && typeof w.activeNoteIdByMode === 'object') ? w.activeNoteIdByMode : null,
          notes: Array.isArray(w.notes) ? w.notes : [],
          activeNoteId: w.activeNoteId || null,
          crop: w.crop || null,
        });
      });

      if(data?.stage){
        if(typeof data.stage.minWidth === 'string') stage.style.minWidth = data.stage.minWidth;
        if(typeof data.stage.minHeight === 'string') stage.style.minHeight = data.stage.minHeight;
        stage.scrollLeft = Number(data.stage.scrollLeft || 0);
        stage.scrollTop  = Number(data.stage.scrollTop || 0);
      }

      setEditMode(editMode);
      setMode(data.mode === 'memomo' ? 'memomo' : 'dropboard');

      if(!isMemomo()){
        restoreDropboardLayoutToDOM();
        applyDropboardPage();
      // v5: swap note set per mode
      $$('.win', stage).forEach(w=> renderNotes(w));
      }else{
        applyMemomoLayout();
      }
    }catch(err){
      console.warn('restore failed', err);
    }
  }

  // initial
  (async function init(){
    recomputeStageBounds();
    await restoreIfPossible();
    // if nothing restored, defaults stay (edit ON, dropboard)
    setEditMode(editMode);
    setMode(mode);
    // v7: ensure dropboard pager is refreshed even if mode didn't change
    if(!isMemomo()) applyDropboardPage(); else renderThumbs();
  })();
})();
