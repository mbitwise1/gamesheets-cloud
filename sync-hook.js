// sync-hook.js — v2 (targets your app’s variables: currentWB/currentFileRec)
// Drop-in: load AFTER your app.js and firebase-sync.js.
//
// Hooks these if present:
//   • saveBackToIndexedDB(...)
//   • syncMatrixIntoWorkbook(...)
//   • StorageGS.autosaveWorkbook({...})   <-- your app already calls this
//
// Snapshot serializer now checks: currentWB → workbook (fallback).

(function(){
  function captureWorkbookArrayBuffer(){
    try{
      if (window.XLSX){
        if (window.currentWB){
          return window.XLSX.write(window.currentWB, { bookType:'xlsx', type:'array' });
        }
        if (window.workbook){
          return window.XLSX.write(window.workbook, { bookType:'xlsx', type:'array' });
        }
      }
    }catch(e){
      console.warn('[GSCloudHook] capture error:', e.message);
    }
    return null;
  }

  async function pushToCloud(meta){
    try{
      if(!window.FirebaseSync) return;
      const ab = captureWorkbookArrayBuffer();
      if(!ab) return;
      const rec = window.currentFileRec || {};
      const fileId = rec.id || ('local-' + Date.now());
      const name  = rec.name || (document.title || 'GameSheet');
      await window.FirebaseSync.uploadWorkbook(fileId, name, ab, meta||{});
      console.log('[GSCloudHook] pushed snapshot to cloud', { fileId, name, meta });
    }catch(e){
      console.warn('[GSCloudHook] push skipped:', e.message);
    }
  }

  function wireWrappers(){
    // Wrap explicit "save"
    try{
      const origSave = window.saveBackToIndexedDB;
      if(typeof origSave === 'function'){
        window.saveBackToIndexedDB = async function(){
          const res = await origSave.apply(this, arguments);
          try{ await pushToCloud({ reason: 'save' }); }catch(_e){}
          return res;
        };
        console.log('[GSCloudHook] wired saveBackToIndexedDB');
      }
    }catch(_e){}

    // Wrap matrix sync
    try{
      const origSync = window.syncMatrixIntoWorkbook;
      if(typeof origSync === 'function'){
        window.syncMatrixIntoWorkbook = async function(){
          const r = await origSync.apply(this, arguments);
          try{ await pushToCloud({ reason: 'sync' }); }catch(_e){}
          return r;
        };
        console.log('[GSCloudHook] wired syncMatrixIntoWorkbook');
      }
    }catch(_e){}

    // Wrap autosave bridge that your app already calls
    try{
      if(window.StorageGS && typeof window.StorageGS.autosaveWorkbook === 'function'){
        const _origAuto = window.StorageGS.autosaveWorkbook;
        window.StorageGS.autosaveWorkbook = async function(opts){
          const res = await _origAuto.apply(this, arguments);
          try{ await pushToCloud(Object.assign({ reason:'autosave' }, opts && opts.meta ? opts.meta : {})); }catch(_e){}
          return res;
        };
        console.log('[GSCloudHook] wired StorageGS.autosaveWorkbook');
      }
    }catch(_e){}
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wireWrappers);
  }else{
    wireWrappers();
  }

  window.GSCloudHook = { pushToCloud };
})();
