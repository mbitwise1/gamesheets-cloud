// progress-sync.js — FULL cloud progress sync (Q1:A last-write-wins, Q2:B on tab switch/open)
//
// Stores per-file progress in Firestore at:
//   users/{uid}/files/{fileId}/progress/data
// Shape:
//   { sheets: { "<sheetName>": { cells: { "A1": true|false|"opt:VALUE" }, updated_at: 123 } }, updated_at: 123 }
//
// Integration points (generic):
//  • Call ProgressSync.bind() once after FirebaseSync.init() and after your UI is ready.
//  • It auto-detects tab clicks on elements with [data-sheet], .sheet-tab, or .tab-button.
//  • It saves current sheet progress on tab change / close, and loads progress for the new tab.
//  • It reads DOM inputs inside .sheet-view (checkboxes + selects) and maps them to cell keys.
//    - It looks for data-cell="A1" or data-row/data-col on the input or ancestor .cell.
//
// If your DOM differs, you can call APIs directly:
//   ProgressSync.saveForSheet(fileId, sheetName)
//   ProgressSync.loadForSheet(fileId, sheetName)
//
(function(){
  const SCOPE = 'users';
  const SUBCOL = 'files';
  const PROG = 'progress';
  const DOC = 'data';

  const ProgressSync = {};
  let db, auth;
  let current = { fileId: null, sheet: null };

  function colToA1(n){
    let s = '';
    n = Number(n);
    while(n >= 0){
      s = String.fromCharCode((n % 26) + 65) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }
  function keyFromEl(el){
    // Prefer data-cell="A1"
    let node = el;
    while(node){
      const a1 = node.getAttribute && node.getAttribute('data-cell');
      if(a1) return a1;
      const r = node.getAttribute && node.getAttribute('data-row');
      const c = node.getAttribute && node.getAttribute('data-col');
      if(r != null && c != null){
        return colToA1(Number(c)) + String(Number(r)+1);
      }
      node = node.parentElement;
    }
    return null;
  }

  function getScope(){
    if(!window.FirebaseSync || !window.FirebaseSync._internals){
      throw new Error('FirebaseSync not initialized');
    }
    db = window.FirebaseSync._internals.db;
    auth = window.FirebaseSync._internals.auth;
    if(!auth || !auth.currentUser) throw new Error('Not signed in');
    return { db, uid: auth.currentUser.uid };
  }

  function docRef(fileId){
    const { db, uid } = getScope();
    return db.collection(SCOPE).doc(uid).collection(SUBCOL).doc(fileId)
             .collection(PROG).doc(DOC);
  }

  async function loadForSheet(fileId, sheetName){
    try{
      const ref = docRef(fileId);
      const snap = await ref.get();
      const data = snap.exists ? (snap.data() || {}) : {};
      const sheet = (data.sheets && data.sheets[sheetName]) || { cells:{} };
      applyToDOM(sheet.cells);
    }catch(e){
      console.warn('[ProgressSync] load failed:', e.message);
    }
  }

  function applyToDOM(cells){
    const scope = document.querySelector('.sheet-view') || document;
    // Checkboxes
    scope.querySelectorAll('input[type=checkbox]').forEach(ch => {
      const k = keyFromEl(ch);
      if(!k) return;
      if(k in cells){ ch.checked = !!cells[k]; }
    });
    // Selects
    scope.querySelectorAll('select').forEach(sel => {
      const k = keyFromEl(sel);
      if(!k) return;
      const v = cells[k];
      if(typeof v === 'string' && v.startsWith('opt:')){
        sel.value = v.slice(4);
      }
    });
    // Recompute progress if app exposes it
    if(typeof window.updateCurrentSheetProgress === 'function'){
      window.updateCurrentSheetProgress();
    }
  }

  function collectFromDOM(){
    const scope = document.querySelector('.sheet-view') || document;
    const cells = {};
    scope.querySelectorAll('input[type=checkbox]').forEach(ch => {
      const k = keyFromEl(ch);
      if(!k) return;
      cells[k] = !!ch.checked;
    });
    scope.querySelectorAll('select').forEach(sel => {
      const k = keyFromEl(sel);
      if(!k) return;
      cells[k] = 'opt:' + String(sel.value);
    });
    return cells;
  }

  async function saveForSheet(fileId, sheetName){
    try{
      const ref = docRef(fileId);
      const cells = collectFromDOM();
      const payload = {
        updated_at: Date.now(),
        sheets: {}
      };
      payload.sheets[sheetName] = { cells, updated_at: Date.now() };
      // Q1:A last-write-wins, Q2:B on tab switch/open => merge w/ overwrite
      await ref.set(payload, { merge: true });
    }catch(e){
      console.warn('[ProgressSync] save failed:', e.message);
    }
  }

  function detectFileId(){
    const rec = window.currentFileRec || {};
    return rec.id || 'default-file';
  }
  function detectSheetName(){
    const active = document.querySelector('.tab-button.active, .sheet-tab.active, [data-sheet].active');
    if(active && active.getAttribute){
      return active.getAttribute('data-sheet') || active.textContent.trim() || 'Sheet1';
    }
    // Fallback to title or default
    return (window.currentSheetName) || 'Sheet1';
  }

  function wireTabs(){
    // Generic click capture on tabbars
    const container = document.body;
    let last = { fileId: null, sheet: null };

    container.addEventListener('click', async (e) => {
      const t = e.target;
      const looksTab = t.closest && t.closest('[data-sheet], .sheet-tab, .tab-button');
      if(!looksTab) return;

      const fileId = detectFileId();
      const sheetNow = detectSheetName();

      if(current.fileId && current.sheet){
        await saveForSheet(current.fileId, current.sheet);
      }
      // allow UI to switch sheet, then load
      setTimeout(async () => {
        const newSheet = detectSheetName();
        await loadForSheet(fileId, newSheet);
        current = { fileId, sheet: newSheet };
      }, 0);
    });

    // On initial bind, set current and load
    setTimeout(async () => {
      const fileId = detectFileId();
      const sheet = detectSheetName();
      await loadForSheet(fileId, sheet);
      current = { fileId, sheet };
    }, 0);

    // Save when spreadsheet modal closes (generic hook)
    window.addEventListener('beforeunload', async () => {
      if(current.fileId && current.sheet){
        await saveForSheet(current.fileId, current.sheet);
      }
    });
  }

  ProgressSync.bind = function(){
    try{
      // Ensure Firebase available and user signed in
      const _ = getScope();
      wireTabs();
      console.log('[ProgressSync] bound (Q1:A last-write-wins, Q2:B tab switch/open)');
    }catch(e){
      console.warn('[ProgressSync] not bound:', e.message);
    }
  };
  ProgressSync.saveForSheet = saveForSheet;
  ProgressSync.loadForSheet = loadForSheet;

  window.ProgressSync = ProgressSync;
})();
