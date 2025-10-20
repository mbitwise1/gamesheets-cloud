// progress-sync.js — FULL cloud progress sync
// Q1: Last write wins. Q2: Sync on tab switch/open (not realtime listener).
// Assumes cells are identified with data-cell="A1".

(function(){
  const PATH_USERS = "users";
  const PATH_FILES = "files";
  const PATH_PROGRESS = "progress";
  const DOC_DATA = "data";

  const ProgressSync = {};
  let db, auth;
  let current = { fileId: null, sheet: null };

  function getScope() {
    if (!window.FirebaseSync || !window.FirebaseSync._internals) throw new Error("FirebaseSync not ready");
    db = window.FirebaseSync._internals.db;
    auth = window.FirebaseSync._internals.auth;
    if (!auth || !auth.currentUser) throw new Error("Not signed in");
    return { db, uid: auth.currentUser.uid };
  }

  function detectFileId(){
    const rec = window.currentFileRec || {};
    return rec.id || "default-file";
  }
  function detectSheetName(){
    const active = document.querySelector('.tab-button.active, .sheet-tab.active, [data-sheet].active');
    if (active){
      const ds = active.getAttribute("data-sheet");
      if (ds) return ds;
      const txt = (active.textContent||"").trim();
      if (txt) return txt;
    }
    return (window.currentSheetName) || "Sheet1";
  }

  function progressDoc(fileId){
    const { db, uid } = getScope();
    return db.collection(PATH_USERS).doc(uid).collection(PATH_FILES).doc(fileId)
             .collection(PATH_PROGRESS).doc(DOC_DATA);
  }

  function collectCells(){
    const scope = document.querySelector(".sheet-view") || document;
    const map = {};
    scope.querySelectorAll('input[type="checkbox"][data-cell]').forEach(ch => {
      const key = ch.getAttribute("data-cell"); if (!key) return;
      map[key] = !!ch.checked;
    });
    scope.querySelectorAll('select[data-cell]').forEach(sel => {
      const key = sel.getAttribute("data-cell"); if (!key) return;
      map[key] = "opt:" + String(sel.value);
    });
    return map;
  }

  function applyCells(cells){
    const scope = document.querySelector(".sheet-view") || document;
    scope.querySelectorAll('input[type="checkbox"][data-cell]').forEach(ch => {
      const key = ch.getAttribute("data-cell"); if (!key) return;
      if (Object.prototype.hasOwnProperty.call(cells, key)) { ch.checked = !!cells[key]; }
    });
    scope.querySelectorAll('select[data-cell]').forEach(sel => {
      const key = sel.getAttribute("data-cell"); if (!key) return;
      const v = cells[key];
      if (typeof v === "string" && v.startsWith("opt:")) { sel.value = v.slice(4); }
    });
    if (typeof window.updateCurrentSheetProgress === "function") {
      try{ window.updateCurrentSheetProgress(); }catch(_){}
    }
  }

  async function saveForSheet(fileId, sheetName){
    try{
      const ref = progressDoc(fileId);
      const cells = collectCells();
      const payload = { updated_at: Date.now(), sheets: {} };
      payload.sheets[sheetName] = { cells, updated_at: Date.now() };
      await window.FirebaseSync._internals.ensureOnline();
      await ref.set(payload, { merge: true });
      try{
        const { uid } = getScope();
        await db.collection(PATH_USERS).doc(uid).collection(PATH_FILES).doc(fileId)
          .set({ updated_at: Date.now() }, { merge: true });
      }catch(_){}
    }catch(e){
      console.warn("[ProgressSync] save failed:", e && e.message);
    }
  }

  async function loadForSheet(fileId, sheetName){
    try{
      const ref = progressDoc(fileId);
      await window.FirebaseSync._internals.ensureOnline();
      const snap = await ref.get();
      const data = snap.exists ? (snap.data() || {}) : {};
      const sheet = (data.sheets && data.sheets[sheetName]) || { cells:{} };
      applyCells(sheet.cells || {});
    }catch(e){
      console.warn("[ProgressSync] load failed:", e && e.message);
    }
  }

  function wireTabSwitch(){
    const container = document.body;
    container.addEventListener("click", async (e) => {
      const tab = e.target.closest && e.target.closest("[data-sheet], .sheet-tab, .tab-button");
      if (!tab) return;
      if (current.fileId && current.sheet) { await saveForSheet(current.fileId, current.sheet); }
      setTimeout(async ()=>{
        const fileId = detectFileId();
        const newSheet = detectSheetName();
        await loadForSheet(fileId, newSheet);
        current = { fileId, sheet: newSheet };
      }, 0);
    });

    setTimeout(async ()=>{
      const fileId = detectFileId();
      const sheet = detectSheetName();
      await loadForSheet(fileId, sheet);
      current = { fileId, sheet };
    }, 0);

    window.addEventListener("beforeunload", async ()=>{
      if (current.fileId && current.sheet) { await saveForSheet(current.fileId, current.sheet); }
    });
  }

  ProgressSync.bind = function(){
    try{
      const { uid } = getScope();
      wireTabSwitch();
      console.log("[ProgressSync] bound for uid:", uid);
    }catch(e){
      console.warn("[ProgressSync] not bound yet:", e && e.message);
      setTimeout(ProgressSync.bind, 600);
    }
  };

  ProgressSync.saveForSheet = saveForSheet;
  ProgressSync.loadForSheet = loadForSheet;

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ()=> ProgressSync.bind());
  } else {
    ProgressSync.bind();
  }

  window.ProgressSync = ProgressSync;
})();