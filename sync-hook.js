// sync-hook.js — bridges local autosave to cloud sync (when signed in)
(function(){
  async function pushIfPossible(ab, meta){
    try{
      if(!window.FirebaseSync) return;
      const rec = window.currentFileRec || {};
      if(!rec.id || !rec.name) return;
      await window.FirebaseSync.uploadWorkbook(rec.id, rec.name, ab, meta||{});
    }catch(e){
      console.warn('[CloudSync] push skipped:', e.message);
    }
  }

  try{
    if(window.StorageGS && typeof window.StorageGS.autosaveWorkbook === 'function'){
      const _orig = window.StorageGS.autosaveWorkbook;
      window.StorageGS.autosaveWorkbook = async function(opts){
        const res = await _orig.apply(this, arguments);
        try{
          const ab = opts.arrayBuffer;
          const meta = opts.meta || {};
          await pushIfPossible(ab, meta);
        }catch(_e){}
        return res;
      };
    }
  }catch(_e){}
})();
