
/* GameSheets — app.js (Stable + Adaptive Layout) */

// ------------------------------
// IndexedDB setup (games, files, links)
// ------------------------------
var DB_NAME = 'GameSheetsDB';
var DB_VERSION = 2; // links store
var db;

function openDB(){
  return new Promise(function(resolve, reject){
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if(!db.objectStoreNames.contains('games')){
        var games = db.createObjectStore('games', { keyPath:'id', autoIncrement:true });
        games.createIndex('name','name',{unique:false});
      }
      if(!db.objectStoreNames.contains('files')){
        var files = db.createObjectStore('files', { keyPath:'id', autoIncrement:true });
        files.createIndex('byGame','gameId',{unique:false});
        files.createIndex('byName','name',{unique:false});
      }
      if(!db.objectStoreNames.contains('links')){
        var links = db.createObjectStore('links', { keyPath:'id', autoIncrement:true });
        links.createIndex('byGame','gameId',{unique:false});
      }
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}

function tx(store, mode){
  if(mode===void 0) mode='readonly';
  var t = db.transaction(store, mode); return t.objectStore(store);
}

// ------------------------------
// Games
// ------------------------------
function addGame(name){
  name = (name||'').trim(); if(!name) return Promise.resolve(null);
  return new Promise(function(res,rej){
    var req=tx('games','readwrite').add({ name:name });
    req.onsuccess=function(){ res(req.result); };
    req.onerror=function(){ rej(req.error); };
  });
}
function listGames(){
  return new Promise(function(res,rej){
    var out=[]; var req=tx('games').openCursor();
    req.onsuccess=function(e){ var cur=e.target.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out); };
    req.onerror=function(){ rej(req.error); };
  });
}
function getGame(id){
  return new Promise(function(res,rej){
    var req=tx('games').get(id);
    req.onsuccess=function(){ res(req.result); };
    req.onerror=function(){ rej(req.error); };
  });
}
function renameGame(id, name){
  return getGame(id).then(function(g){
    if(!g) return; g.name=(name||'').trim();
    return new Promise(function(res,rej){
      var req=tx('games','readwrite').put(g);
      req.onsuccess=function(){ res(); };
      req.onerror=function(){ rej(req.error); };
    });
  });
}
function deleteGame(id){
  return (async function(){
    var files = await listFiles(id);
    for(var i=0;i<files.length;i++) await deleteFile(files[i].id);
    var links = await listLinks(id);
    for(var j=0;j<links.length;j++) await deleteLink(links[j].id);
    return new Promise(function(res,rej){
      var req=tx('games','readwrite').delete(id);
      req.onsuccess=function(){ res(); };
      req.onerror=function(){ rej(req.error); };
    });
  })();
}

// ------------------------------
// Files (local uploads)
// ------------------------------
function addFiles(gameId, fileList){
  var store=tx('files','readwrite');
  return Promise.all(Array.prototype.map.call(fileList, function(file){
    return new Promise(function(res,rej){
      var now=Date.now();
      var rec={ gameId:gameId, name:file.name, type:file.type||guessType(file.name), size:file.size, addedAt:now, blob:file, exactUrl:'' };
      var req=store.add(rec);
      req.onsuccess=function(){ res(); };
      req.onerror=function(){ rej(req.error); };
    });
  }));
}
function listFiles(gameId){
  return new Promise(function(res,rej){
    var out=[]; var idx=tx('files').index('byGame'); var range=IDBKeyRange.only(gameId);
    var req=idx.openCursor(range);
    req.onsuccess=function(e){ var cur=e.target.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out); };
    req.onerror=function(){ rej(req.error); };
  });
}
function getFile(id){
  return new Promise(function(res,rej){
    var req=tx('files').get(id);
    req.onsuccess=function(){ res(req.result); };
    req.onerror=function(){ rej(req.error); };
  });
}
function putFile(rec){
  return new Promise(function(res,rej){
    var req=tx('files','readwrite').put(rec);
    req.onsuccess=function(){ res(); };
    req.onerror=function(){ rej(req.error); };
  });
}
function updateFileName(id,name){
  return new Promise(function(res,rej){
    var store=tx('files','readwrite'); var get=store.get(id);
    get.onsuccess=function(){
      var rec=get.result; if(!rec){ res(); return; }
      rec.name=name;
      var put=store.put(rec);
      put.onsuccess=function(){ res(); };
      put.onerror=function(){ rej(put.error); };
    };
    get.onerror=function(){ rej(get.error); };
  });
}
function updateFileExactUrl(id,url){
  return new Promise(function(res,rej){
    var store=tx('files','readwrite'); var get=store.get(id);
    get.onsuccess=function(){
      var rec=get.result; if(!rec){ res(); return; }
      rec.exactUrl=url;
      var put=store.put(rec);
      put.onsuccess=function(){ res(); };
      put.onerror=function(){ rej(put.error); };
    };
    get.onerror=function(){ rej(get.error); };
  });
}
function deleteFile(id){
  return new Promise(function(res,rej){
    var req=tx('files','readwrite').delete(id);
    req.onsuccess=function(){ res(); };
    req.onerror=function(){ rej(req.error); };
  });
}

// ------------------------------
// Links (standalone online spreadsheets)
// ------------------------------
function addLink(gameId, name, url){
  name=(name||'').trim(); url=(url||'').trim(); if(!name||!url) return Promise.resolve();
  return new Promise(function(res,rej){
    var req=tx('links','readwrite').add({ gameId:gameId, name:name, url:url, addedAt:Date.now() });
    req.onsuccess=function(){ res(req.result); };
    req.onerror=function(){ rej(req.error); };
  });
}
function listLinks(gameId){
  return new Promise(function(res,rej){
    var out=[]; var idx=tx('links').index('byGame'); var req=idx.openCursor(IDBKeyRange.only(gameId));
    req.onsuccess=function(e){ var cur=e.target.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out); };
    req.onerror=function(){ rej(req.error); };
  });
}
function deleteLink(id){
  return new Promise(function(res,rej){
    var req=tx('links','readwrite').delete(id);
    req.onsuccess=function(){ res(); };
    req.onerror=function(){ rej(req.error); };
  });
}

// ------------------------------
// Utilities
// ------------------------------
function downloadBlob(name,blob){
  var url=URL.createObjectURL(blob); var a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
}
function humanSize(n){
  if(n<1024) return n+' B';
  var kb=n/1024; if(kb<1024) return kb.toFixed(1)+' KB';
  var mb=kb/1024; if(mb<1024) return mb.toFixed(2)+' MB';
  var gb=mb/1024; return gb.toFixed(2)+' GB';
}
function guessType(name){
  var low=(name||'').toLowerCase();
  if(low.indexOf('.csv')===low.length-4) return 'text/csv';
  if(low.indexOf('.xlsx')===low.length-5) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if(low.indexOf('.xls')===low.length-4) return 'application/vnd.ms-excel';
  if(low.indexOf('.ods')===low.length-4) return 'application/vnd.oasis.opendocument.spreadsheet';
  return 'application/octet-stream';
}
function ext(name){
  var i=(name||'').lastIndexOf('.'); return i>-1? name.slice(i+1).toLowerCase():'';
}

// ------------------------------
// UI State
// ------------------------------
var currentGameId = null;
var currentWB = null, currentSheetName = null, currentMatrix = null, currentFileRec = null;
var currentWS = null; // XLSX worksheet
var currentAdapt = null; // layout

var els = {};
function mapEls(){
  var ids = ['games','newGameName','addGameBtn','gameTitle','fileCount','gameHelp','renameGameBtn','deleteGameBtn','search','uploadBtn','fileInput','fileBody','linksBody','newLinkName','newLinkUrl','addLinkBtn','exportBtn','importBtn','importFile','downloadHtmlBtn','editorModal','editorTitle','editorMeta','editorBody','sheetTabs','smartControls','addRowBtn','saveBtn','exportCsvBtn','exportXlsxBtn','closeEditor','exactModal','exactTitle','exactFrame','exactWarn','closeExact','openInNewTabBtn','uploadPanel','linksPanel','openEditBtn'];
  for(var i=0;i<ids.length;i++){ var id=ids[i]; els[id]=document.getElementById(id)||null; }
}

function setGameEnabled(enabled){
  if(els.uploadBtn) els.uploadBtn.disabled = !enabled;
  if(els.renameGameBtn) els.renameGameBtn.disabled = !enabled;
  if(els.deleteGameBtn) els.deleteGameBtn.disabled = !enabled;
  if(els.addLinkBtn) els.addLinkBtn.disabled = !enabled;
  if(els.uploadPanel) els.uploadPanel.setAttribute('aria-disabled', String(!enabled));
  if(els.linksPanel) els.linksPanel.setAttribute('aria-disabled', String(!enabled));
  if(els.gameHelp) els.gameHelp.textContent = enabled ? 'Upload spreadsheets or add Exact View links for this game.' : 'Select or create a game on the left to begin.';
}

async function refreshGames(){
  var list = await listGames(); var children=[];
  for(var i=0;i<list.length;i++){
    var g=list[i];
    var files = await listFiles(g.id);
    var btn = document.createElement('button');
    btn.className='game' + (g.id===currentGameId?' active':'');
    btn.dataset.id=g.id;
    var ico=document.createElement('div'); ico.className='pill'; ico.textContent='🎮'; btn.appendChild(ico);
    var nm=document.createElement('div'); nm.className='name'; nm.textContent=g.name; btn.appendChild(nm);
    var meta=document.createElement('div'); meta.className='meta'; meta.textContent=String(files.length); btn.appendChild(meta);
    btn.addEventListener('click', (function(id){ return function(){ selectGame(id); };})(g.id));
    children.push(btn);
  }
  if(els.games) els.games.replaceChildren.apply(els.games, children);
  if(currentGameId && !list.find(function(g){return g.id===currentGameId;})){ currentGameId=null; showNoGame(); }
}

async function selectGame(id){
  currentGameId=id;
  var g=await getGame(id);
  if(!g){ showNoGame(); return; }
  if(els.gameTitle) els.gameTitle.textContent=g.name;
  setGameEnabled(true);
  await refreshFiles();
  await refreshLinks();
  await refreshGames();
}
function showNoGame(){
  if(els.gameTitle) els.gameTitle.textContent='No game selected';
  if(els.fileBody) els.fileBody.innerHTML = '<tr><td colspan="6" class="muted">No files yet.</td></tr>';
  if(els.linksBody) els.linksBody.innerHTML = '<tr><td colspan="4" class="muted">No links yet.</td></tr>';
  if(els.fileCount) els.fileCount.textContent='0 files';
  setGameEnabled(false);
  refreshGames();
}

async function refreshFiles(){
  if(!currentGameId){ showNoGame(); return; }
  var files = await listFiles(currentGameId);
  var q = (els.search && els.search.value ? els.search.value : '').trim().toLowerCase();
  if(q) files = files.filter(function(f){ return f.name.toLowerCase().indexOf(q)>-1; });
  if(els.fileCount) els.fileCount.textContent = String(files.length) + (files.length===1?' file':' files');
  if(!files.length){
    if(els.fileBody) els.fileBody.innerHTML = '<tr><td colspan="6" class="muted">No files yet.</td></tr>';
    return;
  }
  var rows = files.map(function(rec){
    var tr=document.createElement('tr');

    var tdName=document.createElement('td');
    var nameInput=document.createElement('input'); nameInput.type='text'; nameInput.value=rec.name; nameInput.style.width='100%';
    nameInput.addEventListener('change', function(){ updateFileName(rec.id, (nameInput.value||'').trim()||rec.name).then(refreshFiles); });
    tdName.appendChild(nameInput);

    var tdType=document.createElement('td'); tdType.textContent = rec.type||'–';

    var tdSize=document.createElement('td'); tdSize.textContent = humanSize(rec.size);

    var tdDate=document.createElement('td'); tdDate.textContent = new Date(rec.addedAt).toLocaleString();

    var tdUrl=document.createElement('td');
    var urlInput=document.createElement('input'); urlInput.type='text'; urlInput.placeholder='Optional: paste Google/OneDrive link for Exact View'; urlInput.value = rec.exactUrl||'';
    urlInput.addEventListener('change', function(){ updateFileExactUrl(rec.id, (urlInput.value||'').trim()); });
    tdUrl.appendChild(urlInput);

    var tdAct=document.createElement('td');
    var openBtn=document.createElement('button'); openBtn.className='btn secondary'; openBtn.textContent='Open'; openBtn.title='Open offline editor';
    openBtn.addEventListener('click', function(){ openEditor(rec); });
    var exactBtn=document.createElement('button'); exactBtn.className='btn'; exactBtn.textContent='Exact View'; exactBtn.title='Open pixel-perfect view (needs valid link)';
    exactBtn.addEventListener('click', function(){ openExactView(rec.exactUrl||'', rec.name); });
    var dlBtn=document.createElement('button'); dlBtn.className='btn secondary'; dlBtn.textContent='Download';
    dlBtn.addEventListener('click', function(){ downloadBlob(rec.name, rec.blob); });
    var delBtn=document.createElement('button'); delBtn.className='btn secondary danger'; delBtn.textContent='Delete';
    delBtn.addEventListener('click', function(){ deleteFile(rec.id).then(function(){ refreshFiles(); refreshGames(); }); });

    tdAct.appendChild(openBtn); tdAct.appendChild(document.createTextNode(' '));
    tdAct.appendChild(exactBtn); tdAct.appendChild(document.createTextNode(' '));
    tdAct.appendChild(dlBtn); tdAct.appendChild(document.createTextNode(' '));
    tdAct.appendChild(delBtn);

    tr.appendChild(tdName); tr.appendChild(tdType); tr.appendChild(tdSize); tr.appendChild(tdDate); tr.appendChild(tdUrl); tr.appendChild(tdAct);
    return tr;
  });
  if(els.fileBody) els.fileBody.replaceChildren.apply(els.fileBody, rows);
}

async function refreshLinks(){
  if(!currentGameId){ return; }
  var list = await listLinks(currentGameId);
  if(!list.length){
    if(els.linksBody) els.linksBody.innerHTML = '<tr><td colspan="4" class="muted">No links yet.</td></tr>';
    return;
  }
  var rows = list.map(function(link){
    var tr=document.createElement('tr');
    var tdN=document.createElement('td'); tdN.textContent = link.name;
    var tdH=document.createElement('td'); tdH.textContent = hostKind(link.url);
    var tdU=document.createElement('td'); var i=document.createElement('input'); i.type='text'; i.style.width='100%'; i.value=link.url;
    i.addEventListener('change', function(){ addLink(currentGameId, link.name, i.value); });
    tdU.appendChild(i);
    var tdA=document.createElement('td');
    var view=document.createElement('button'); view.className='btn'; view.textContent='Exact View';
    view.addEventListener('click', function(){ openExactView(link.url, link.name); });
    var del=document.createElement('button'); del.className='btn secondary danger'; del.textContent='Delete';
    del.addEventListener('click', function(){ deleteLink(link.id).then(refreshLinks); });
    tdA.appendChild(view); tdA.appendChild(document.createTextNode(' ')); tdA.appendChild(del);
    tr.appendChild(tdN); tr.appendChild(tdH); tr.appendChild(tdU); tr.appendChild(tdA);
    return tr;
  });
  if(els.linksBody) els.linksBody.replaceChildren.apply(els.linksBody, rows);
}

// ------------------------------
// Adaptive extraction for offline editor
// ------------------------------
function pxToCh(px){ var ch = Math.round(px / 8); return Math.max(6, Math.min(60, ch)); }
function wchToCh(wch){ return Math.max(6, Math.min(60, Math.round(wch))); }
function hptToPx(hpt){ return Math.round(hpt * 96 / 72); }

function extractAdapt(ws){
  var adapt = { colCh: null, rowPx: null, merges: [] };
  if(ws && ws['!cols'] && Array.isArray(ws['!cols'])){
    adapt.colCh = ws['!cols'].map(function(col){
      if(!col) return null;
      if (typeof col.wch === 'number') return wchToCh(col.wch);
      if (typeof col.wpx === 'number') return pxToCh(col.wpx);
      return null;
    });
  }
  if(ws && ws['!rows'] && Array.isArray(ws['!rows'])){
    adapt.rowPx = ws['!rows'].map(function(row){
      if(!row) return null;
      if (typeof row.hpx === 'number') return Math.max(22, Math.min(200, Math.round(row.hpx)));
      if (typeof row.hpt === 'number') return Math.max(22, Math.min(200, hptToPx(row.hpt)));
      return null;
    });
  }
  if(ws && ws['!merges'] && Array.isArray(ws['!merges'])){
    adapt.merges = ws['!merges'].map(function(m){ return { s:{r:m.s.r, c:m.s.c}, e:{r:m.e.r, c:m.e.c} }; });
  }
  return adapt;
}
function isMergedCovered(adapt, r, c){
  if(!adapt || !adapt.merges) return null;
  for(var i=0;i<adapt.merges.length;i++){
    var m=adapt.merges[i];
    if(r>=m.s.r && r<=m.e.r && c>=m.s.c && c<=m.e.c){
      if(r===m.s.r && c===m.s.c) return {topLeft:true, span:{rows:m.e.r-m.s.r+1, cols:m.e.c-m.s.c+1}};
      return {covered:true};
    }
  }
  return null;
}

// ------------------------------
// Offline Editor
// ------------------------------
function openEditor(rec){
  if(els.editorTitle) els.editorTitle.textContent = rec.name;
  if(els.editorMeta) els.editorMeta.textContent = (rec.type || 'unknown') + ' • ' + humanSize(rec.size);
  currentFileRec = rec;
  var extension = ext(rec.name);
  (async function(){
    try{
      if(extension==='csv' || rec.type==='text/csv'){
        var text = await rec.blob.text();
        var rows = csvToMatrix(text);
        currentWB = XLSX.utils.book_new();
        currentMatrix = rows;
        currentSheetName='Sheet1';
        var ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(currentWB, ws, currentSheetName);
        currentWS = ws;
        currentAdapt = extractAdapt(ws);
        renderSheetTabs([currentSheetName]);
        renderMatrix(currentMatrix, currentAdapt);
        // After rendering the sheet, compute and display progress for the first (and only) sheet
        updateCurrentSheetProgress();
        openModal(els.editorModal,true);
        return;
      }
      var buf = await rec.blob.arrayBuffer();
      currentWB = XLSX.read(buf,{type:'array'});
      var names=currentWB.SheetNames;
      currentSheetName=names[0];
      currentWS = currentWB.Sheets[currentSheetName];
      currentAdapt = extractAdapt(currentWS);
      currentMatrix = XLSX.utils.sheet_to_json(currentWS, { header:1, blankrows:true, defval:'', raw:true });
      renderSheetTabs(names);
      renderMatrix(currentMatrix, currentAdapt);
      // After rendering the sheet, compute and display progress for the first sheet
      updateCurrentSheetProgress();
      openModal(els.editorModal,true);
    }catch(err){
      alert('Open failed. You can still download the file.\n'+err.message);
    }
  })();
}

function renderSheetTabs(names){
  if(!els.sheetTabs) return;
  els.sheetTabs.replaceChildren();
  names.forEach(function(name){
    // Compute progress for this sheet. We attempt to derive the matrix
    // directly from the workbook without altering current state.
    var pct = 0;
    try{
      if(currentWB && currentWB.Sheets && currentWB.Sheets[name]){
        var ws = currentWB.Sheets[name];
        var matrix = XLSX.utils.sheet_to_json(ws, { header:1, blankrows:true, defval:'', raw:true });
        var prog = computeProgress(matrix);
        if(prog.total > 0){
          pct = Math.round((prog.completed / prog.total) * 100);
        }
      }
    }catch(e){ pct = 0; }
    var b=document.createElement('button');
    b.dataset.sheetName = name;
    b.textContent = name + ' (' + pct + '%)';
    if(name===currentSheetName) b.classList.add('active');
    b.addEventListener('click', function(){
      // Before switching sheets, persist any changes made to the current sheet
      // into the workbook so they are retained when coming back. This ensures
      // checkbox states and other edits are not lost when navigating tabs.
      if(currentWB && currentMatrix && currentSheetName){
        try{
          syncMatrixIntoWorkbook();
        }catch(e){ /* ignore errors */ }
      }
      currentSheetName = name;
      currentWS = currentWB.Sheets[name];
      currentAdapt = extractAdapt(currentWS);
      currentMatrix = XLSX.utils.sheet_to_json(currentWS, { header:1, blankrows:true, defval:'', raw:true });
      renderSheetTabs(names);
      renderMatrix(currentMatrix, currentAdapt);
      // Update progress meta for newly selected sheet
      updateCurrentSheetProgress();
    });
    els.sheetTabs.appendChild(b);
  });
}

function csvToMatrix(text){ return text.split(/\r?\n/).map(function(line){ return line? line.split(/,(?=(?:[^\"]*\"[^\"]*\")[^\"]*$)/).map(function(c){ return stripQuotes(c); }) : ['']; }); }
function matrixToCSV(matrix){
  return matrix.map(function(row){
    return row.map(function(cell){
      var s = cell==null? '' : String(cell);
      if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
      return s;
    }).join(',');
  }).join('\n');
}
function stripQuotes(s){ if(s==null) return ''; s=String(s); if(s.startsWith('"') && s.endsWith('"')) return s.slice(1,-1).replace(/""/g,'"'); return s; }
function headerRow(matrix){ return matrix.length? matrix[0] : []; }

/**
 * Compute progress for a sheet matrix. Progress is defined as the number of
 * boolean-like cells that are checked (true) divided by the total number of
 * boolean-like cells. Cells in the header row (row 0) are ignored. The
 * returned object contains the completed and total counts. You can derive
 * the percentage by dividing completed by total and multiplying by 100.
 *
 * @param {Array<Array<any>>} matrix The sheet data as a 2D array.
 * @returns {{completed:number,total:number}}
 */
function computeProgress(matrix){
  var completed = 0;
  var total = 0;
  if(!Array.isArray(matrix)) return { completed: 0, total: 0 };
  for(var r = 1; r < matrix.length; r++){
    var row = matrix[r];
    if(!row) continue;
    for(var c = 0; c < row.length; c++){
      var val = row[c];
      if(isBooleanLike(val)){
        total++;
        if(normalizeBool(val)) completed++;
      }
    }
  }
  return { completed: completed, total: total };
}

/**
 * Update the progress percentage for the currently active sheet. This will
 * recompute progress based on the currentMatrix, update the sheet tab
 * label to include the percentage, and update the editor metadata to
 * include the progress next to the file type and size. This function
 * should be called whenever a checkbox is toggled or when a sheet is
 * rendered.
 */
function updateCurrentSheetProgress(){
  if(!currentMatrix || !els.sheetTabs) return;
  var prog = computeProgress(currentMatrix);
  var pct = 0;
  if(prog.total > 0){
    pct = Math.round((prog.completed / prog.total) * 100);
  }
  // Update tab label for current sheet
  var buttons = els.sheetTabs.querySelectorAll('button');
  buttons.forEach(function(b){
    var name = b.dataset.sheetName || '';
    if(!name){
      // Attempt to derive name from text content before parentheses
      var idx = b.textContent.indexOf(' (');
      if(idx >= 0) name = b.textContent.slice(0, idx);
      else name = b.textContent;
    }
    if(name === currentSheetName){
      b.textContent = name + ' (' + pct + '%)';
    }
  });
  // Update editor meta line with progress (type • size • progress%) if editorMeta exists
  if(currentFileRec && els.editorMeta){
    var text = '';
    if(currentFileRec.type){ text += currentFileRec.type; }
    if(currentFileRec.size != null){
      if(text) text += ' • ';
      text += humanSize(currentFileRec.size);
    }
    // Append progress if there are boolean-like values
    if(prog.total > 0){
      if(text) text += ' • ';
      text += pct + '% complete';
    }
    els.editorMeta.textContent = text;
  }
}
/**
 * Analyze a column to determine its unique values, how many non-empty values there are,
 * and how many of those values look like booleans.
 * This is used to improve the heuristics for selecting input types. By also
 * returning the total number of non-empty values, callers can decide if a
 * column has enough duplication to warrant a dropdown.
 */
function analyzeColumn(matrix, col){
  var seen = {};
  var uniques = [];
  var total = 0;
  var boolCount = 0;
  for(var r=1; r < matrix.length; r++){
    var row = matrix[r];
    var v = (row && row[col] !== undefined) ? row[col] : undefined;
    if(v !== '' && v != null){
      total++;
      if(isBooleanLike(v)) boolCount++;
      var key = String(v);
      if(!seen[key]){
        seen[key] = 1;
        uniques.push(key);
        // We only care about up to 12 unique values for performance reasons
        if(uniques.length > 12) break;
      }
    }
  }
  return { uniques: uniques, total: total, boolCount: boolCount };
}

// Backwards compatibility: retain uniqueValuesByCol for any existing usages.
function uniqueValuesByCol(matrix, col){
  return analyzeColumn(matrix, col).uniques;
}
function isBooleanLike(v){
  if(typeof v==='boolean') return true;
  var s=String(v).trim().toLowerCase();
  return s==='true'||s==='false'||s==='yes'||s==='no'||s==='y'||s==='n'||s==='1'||s==='0'||s==='☑'||s==='☐';
}
function normalizeBool(v){
  var s=String(v).trim().toLowerCase();
  return (s==='true'||s==='yes'||s==='y'||s==='1'||s==='☑');
}

/**
 * Determine whether a given row should be treated as a section header rather than
 * editable data. A section header row typically contains only a handful of
 * non-empty values (excluding boolean-like values) relative to the total
 * number of columns, or represents a merged title across multiple columns.
 *
 * The heuristics used here consider a row to be a section header when:
 *  - There are no boolean-like values in the row.
 *  - The number of non-empty, non-boolean values is less than or equal to 2,
 *    OR those values occupy less than 20% of the total columns.
 *  - Additionally, if there is a merge spanning more than one column starting
 *    on this row, it is also treated as a section header.
 *
 * These rules are imperfect but provide reasonable defaults for many
 * spreadsheets that organize data into sections with titles. Users can
 * override this behaviour by disabling smart controls.
 *
 * @param {Array<Array<any>>} matrix The sheet data as a 2D array.
 * @param {number} r The row index to test.
 * @param {Object} adapt The adapt object containing merge information.
 * @returns {boolean} True if the row is considered a section header.
 */
function isSectionHeaderRow(matrix, r, adapt, colStats){
  if(!matrix || r <= 0) return false; // never treat header row (r==0) as section
  var row = matrix[r] || [];
  var nonEmptyCount = 0;
  var boolCount = 0;
  var totalCols = 0;
  // Track positions of non-boolean, non-empty values
  var positions = [];
  // Flag indicating if the row contains colon-ending labels (e.g., "Player Name:") which are
  // typically form fields rather than section headers. If any cell ends with a colon,
  // the row is not considered a header.
  var hasColonLabel = false;
  // Track value counts for duplicate detection. We only count string values
  // (excluding booleans) because duplicates of strings like "Name" or "Location"
  // often indicate a header row repeated across groups. If a value appears
  // multiple times within the same row, we treat that row as a header.
  var valueCounts = {};
  var hasDuplicateStrings = false;
  for(var i = 0; i < row.length; i++){
    var v = row[i];
    if(v !== '' && v != null){
      totalCols = Math.max(totalCols, i+1);
      if(isBooleanLike(v)){
        boolCount++;
      } else {
        nonEmptyCount++;
        positions.push(i);
        // Check for colon-ending labels
        if(typeof v === 'string' && v.trim().endsWith(':')){
          hasColonLabel = true;
        }
        // Count duplicate string values to detect repeated headers (e.g., Name, Location)
        if(typeof v === 'string'){
          var key = v.trim();
          if(key){
            if(valueCounts[key]){
              hasDuplicateStrings = true;
            } else {
              valueCounts[key] = 1;
            }
          }
        }
      }
    }
  }
  // Do not treat rows containing booleans as section headers
  if(boolCount > 0) return false;
  // Rows with colon labels are likely data-entry prompts rather than headers
  if(hasColonLabel) return false;
  // Determine ratio of non-empty, non-boolean values to total columns
  var ratio = totalCols > 0 ? (nonEmptyCount / totalCols) : 0;
  // Check for merges on this row
  var isMerged = false;
  if(adapt && adapt.merges){
    for(var mIdx = 0; mIdx < adapt.merges.length; mIdx++){
      var m = adapt.merges[mIdx];
      if(m.s.r === r && (m.e.c - m.s.c) >= 1){
        isMerged = true;
        break;
      }
    }
  }
  // Column-level check: treat as header only if all columns containing non-boolean values
  // have very few total entries (<=2) across the entire sheet. This helps avoid
  // misclassifying data rows with sparse entries in wide tables.
  var colCondition = true;
  if(colStats){
    for(var idx = 0; idx < positions.length; idx++){
      var c = positions[idx];
      var stat = colStats[c];
      if(stat && stat.total > 2){
        colCondition = false;
        break;
      }
    }
  }
  // Final decision: a row is a section header if one of these conditions holds:
  // 1. The row has duplicate string values (e.g., repeating "Name" or "Location"), indicating
  //    a repeated header across grouped columns.
  // 2. The row has few non-empty values (<=2) or a low ratio (<=0.3) or is merged,
  //    AND passes the column-level condition. We slightly relax the ratio threshold
  //    compared to the original (0.2 -> 0.3) to catch column header rows with three
  //    repeated labels.
  var rowCondition = (nonEmptyCount <= 2 || ratio <= 0.3);
  if(hasDuplicateStrings){
    return true;
  }
  return ( (rowCondition || isMerged) && colCondition );
}

function autosizeColumns(matrix){
  var rows=matrix||[];
  var cols=Math.max.apply(Math, rows.map(function(r){return r.length;} ).concat([1]));
  var widths=new Array(cols); for(var i=0;i<cols;i++) widths[i]=0;
  for(var c=0;c<cols;c++){
    var maxLen=0;
    for(var r=0;r<rows.length;r++){
      var val=rows[r] && rows[r][c]!==undefined ? rows[r][c] : '';
      var txt=(val==null?'':String(val));
      var est=txt.length + ((txt.match(/[MW@#]/g)||[]).length)*0.4;
      if(est>maxLen)maxLen=est;
      if(maxLen>80)break;
    }
    var minCh=8, maxCh=36;
    var ch=Math.min(Math.max(Math.ceil(maxLen*0.9+2),minCh),maxCh);
    widths[c]=ch;
  }
  return widths;
}

function renderMatrix(matrix, adapt){
  var table=document.createElement('table');
  table.className='table';

  // Column widths
  var autoW = autosizeColumns(matrix);
  var colCh = (adapt && adapt.colCh) ? adapt.colCh.map(function(v,i){ return (typeof v==='number'? v : (autoW[i] || 12)); }) : autoW;
  var colgroup=document.createElement('colgroup');
  colCh.forEach(function(w){ var col=document.createElement('col'); col.style.width = w + 'ch'; colgroup.appendChild(col); });
  table.appendChild(colgroup);

  // THEAD
  var thead=document.createElement('thead'); thead.className='thead'; var trh=document.createElement('tr');
  var header = headerRow(matrix);
  var cols = Math.max.apply(Math, matrix.map(function(r){return r.length;}).concat([1]));
  var headMerges = (adapt && adapt.merges ? adapt.merges.filter(function(m){ return m.s.r===0; }) : []);
  var skipHead = {};
  function inHeadMerge(r,c){
    for(var i=0;i<headMerges.length;i++){
      var m=headMerges[i];
      if(r>=m.s.r && r<=m.e.r && c>=m.s.c && c<=m.e.c) return m;
    }
    return null;
  }
  for(var c=0;c<cols;c++){
    if(skipHead[c]) continue;
    var merge = inHeadMerge(0,c);
    var th=document.createElement('th'); th.textContent = (header[c]!==undefined? header[c] : '');
    if(merge){
      var colspan = merge.e.c - merge.s.c + 1;
      var rowspan = merge.e.r - merge.s.r + 1;
      if(colspan>1) th.colSpan = colspan;
      if(rowspan>1) th.rowSpan = rowspan;
      for(var cc=c+1; cc<=merge.e.c; cc++) skipHead[cc]=true;
    }
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  var tbody=document.createElement('tbody');

  // Determine whether smart controls are enabled once per render.
  var useSmart = (els.smartControls ? !!els.smartControls.checked : true);
  // Precompute statistics for each column to improve input-type heuristics. Use a
  // separate variable (colCount) to avoid shadowing the `cols` variable defined later.
  var colStats = [];
  var colCount = Math.max.apply(Math, matrix.map(function(r){ return r.length; }).concat([1]));
  if(useSmart){
    for(var cIdx = 0; cIdx < colCount; cIdx++){
      colStats[cIdx] = analyzeColumn(matrix, cIdx);
    }
  }
  for(var r=1;r<matrix.length;r++){
    var tr=document.createElement('tr');
    var rh = adapt && adapt.rowPx ? adapt.rowPx[r] : null;
    if(typeof rh === 'number') tr.style.height = rh + 'px';

    // Determine if this row is a section header. When smart controls are enabled,
    // section headers will be displayed as plain text without inputs.
    var isSection = useSmart && isSectionHeaderRow(matrix, r, adapt, colStats);

    for(var c2=0;c2<cols;c2++){
      var m = isMergedCovered(adapt, r, c2);
      if(m && m.covered) continue;
      var td=document.createElement('td'); td.className='cell';
      if(m && m.topLeft && (m.span.cols>1 || m.span.rows>1)){
        if(m.span.cols>1) td.colSpan = m.span.cols;
        if(m.span.rows>1) td.rowSpan = m.span.rows;
      }
      if(isSection){
        // For section header rows, simply display the value as text (non-editable).
        // Apply a special class to highlight section headers.
        td.className = 'cell section-header';
        var vSec = (matrix[r] && matrix[r][c2] !== undefined) ? matrix[r][c2] : '';
        td.textContent = String(vSec);
      } else {
        var v = (matrix[r] && matrix[r][c2] !== undefined) ? matrix[r][c2] : '';
        var vStr = String(v);
        var isNum = (vStr !== '' && !isNaN(Number(vStr)));
        var stats = colStats[c2] || { uniques: [], total: 0, boolCount: 0 };
        // Determine the appropriate control based on the column statistics.
        // Determine whether this particular cell should be treated as a boolean.
        var cellIsBool = false;
        if(useSmart){
          // Treat values as boolean-like if they are booleans, numeric 0/1, or strings such as "true", "false", "yes", "no", etc.
          if(isBooleanLike(v)) cellIsBool = true;
        }
        // A column is considered boolean if it has at most two unique non-empty values and all of them are boolean-like.
        var allBooleanUnique = false;
        if(useSmart && stats.uniques && stats.uniques.length > 0 && stats.uniques.length <= 2){
          allBooleanUnique = stats.uniques.every(function(u){ return isBooleanLike(u); });
        }
        if(cellIsBool || (useSmart && allBooleanUnique)){
          // Render a checkbox for boolean cells or for columns with exclusively boolean-like values.
          var wrap=document.createElement('div'); wrap.className='cell-checkbox';
          var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=normalizeBool(v);
          cb.addEventListener('change', (function(r,c2,cb){
            return function(){
              // Store boolean true/false instead of strings to preserve type information
              matrix[r][c2] = !!cb.checked;
              // Recompute and update progress whenever a checkbox is toggled
              updateCurrentSheetProgress();
              // Persist changes immediately to the workbook so edits are not lost
              // when switching sheets.  This ensures that toggling a checkbox
              // writes the updated matrix back to the current workbook sheet.
              try{
                if(currentWB && currentMatrix && currentSheetName){
                  syncMatrixIntoWorkbook();
                }
              }catch(e){ /* ignore errors */ }
            };
          })(r,c2,cb));
          wrap.appendChild(cb); td.appendChild(wrap);
        } else if(useSmart && stats.uniques && stats.uniques.length > 0 && stats.uniques.length <= 10 && stats.uniques.length < stats.total && !allBooleanUnique && stats.boolCount === 0){
          // Column has a manageable number of unique values and enough duplicates to justify a dropdown.
          var sel=document.createElement('select'); sel.className='cell-select';
          var emptyOpt=document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent=''; sel.appendChild(emptyOpt);
          stats.uniques.forEach(function(u){ var o=document.createElement('option'); o.value=u; o.textContent=u; sel.appendChild(o); });
          sel.value=vStr;
          sel.addEventListener('change', (function(r,c2,sel){ return function(){
            // Update matrix with selected value
            matrix[r][c2] = sel.value;
            // Update progress (in case boolean-like values are affected)
            updateCurrentSheetProgress();
            // Persist changes immediately so that switching tabs retains edits
            try{
              if(currentWB && currentMatrix && currentSheetName){
                syncMatrixIntoWorkbook();
              }
            }catch(e){ /* ignore errors */ }
          };})(r,c2,sel));
          td.appendChild(sel);
        } else {
          // Use textarea for long or multi-line content, otherwise a simple input (text or number).
          if(vStr.indexOf('\n') > -1 || vStr.length > 30){
            var ta=document.createElement('textarea'); ta.className='cell-textarea'; ta.value=vStr; ta.rows=5; autoResizeTA(ta);
            ta.style.textAlign = isNum ? 'right' : 'left';
            ta.addEventListener('input', (function(r,c2,ta){ return function(){
              autoResizeTA(ta);
              matrix[r][c2] = ta.value;
              // Update progress and persist changes when editing a textarea
              updateCurrentSheetProgress();
              try{
                if(currentWB && currentMatrix && currentSheetName){
                  syncMatrixIntoWorkbook();
                }
              }catch(e){ /* ignore errors */ }
            };})(r,c2,ta));
            td.appendChild(ta);
          } else {
            var inp=document.createElement('input'); inp.className='cell-input'; inp.type = isNum ? 'number' : 'text'; inp.value = vStr;
            inp.style.textAlign = isNum ? 'right' : 'left';
            inp.addEventListener('change', (function(r,c2,inp){ return function(){
              matrix[r][c2] = (inp.type === 'number' && inp.value !== '') ? Number(inp.value) : inp.value;
              // Update progress and persist changes for input fields
              updateCurrentSheetProgress();
              try{
                if(currentWB && currentMatrix && currentSheetName){
                  syncMatrixIntoWorkbook();
                }
              }catch(e){ /* ignore errors */ }
            };})(r,c2,inp));
            td.appendChild(inp);
          }
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  if(matrix.length<=1){
    var tr0=document.createElement('tr');
    var cols0=Math.max(1, headerRow(matrix).length);
    for(var c3=0;c3<cols0;c3++){
      var td0=document.createElement('td'); var ta0=document.createElement('textarea'); ta0.className='cell-textarea'; ta0.rows=5; ta0.value='';
      (function(c3,ta0){ ta0.addEventListener('input', function(){
        if(!matrix[1]) matrix[1]=[];
        matrix[1][c3] = ta0.value;
        // Update progress and persist changes when editing the first data row
        updateCurrentSheetProgress();
        try{
          if(currentWB && currentMatrix && currentSheetName){
            syncMatrixIntoWorkbook();
          }
        }catch(e){ /* ignore errors */ }
      }); })(c3,ta0);
      td0.appendChild(ta0); tr0.appendChild(td0);
    }
    tbody.appendChild(tr0);
  }

  table.appendChild(thead); table.appendChild(tbody);
  if(els.editorBody) els.editorBody.replaceChildren(table);
}

function autoResizeTA(ta){ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight, window.innerHeight*0.6)+'px'; }
function syncMatrixIntoWorkbook(){
  var ws=XLSX.utils.aoa_to_sheet(currentMatrix);
  if(currentAdapt && currentAdapt.colCh){ ws['!cols'] = currentAdapt.colCh.map(function(ch){ return ch? { wch: ch } : null; }); }
  if(currentAdapt && currentAdapt.rowPx){ ws['!rows'] = currentAdapt.rowPx.map(function(px){ return px? { hpx: px } : null; }); }
  if(currentAdapt && currentAdapt.merges && currentAdapt.merges.length){ ws['!merges'] = currentAdapt.merges.map(function(m){ return {s:{r:m.s.r,c:m.s.c}, e:{r:m.e.r,c:m.e.c}}; }); }
  currentWB.Sheets[currentSheetName]=ws;
  if(currentWB.SheetNames.indexOf(currentSheetName)===-1) currentWB.SheetNames.push(currentSheetName);
}
function addRow(){ var cols=Math.max(1, headerRow(currentMatrix).length); currentMatrix.push(new Array(cols).fill('')); renderMatrix(currentMatrix, currentAdapt); }
function saveBackToIndexedDB(){
  if(!currentFileRec) return;
  var extension=ext(currentFileRec.name);
  var blob, mime;
  if(extension==='csv' || currentFileRec.type==='text/csv'){
    var csv=matrixToCSV(currentMatrix);
    blob = new Blob([csv],{type:'text/csv'});
    mime='text/csv';
  } else {
    syncMatrixIntoWorkbook();
    var ab = XLSX.write(currentWB,{bookType:'xlsx', type:'array'});
    blob = new Blob([ab],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  getFile(currentFileRec.id).then(function(rec){
    rec.blob=blob; rec.type=mime; rec.size=blob.size;
    putFile(rec).then(function(){
      currentFileRec = rec;
      // After saving, update the editor meta to include the new size and progress
      updateCurrentSheetProgress();
      refreshFiles();
      alert('Saved.');
    }).catch(function(e){ alert('Save failed: '+e.message); });
  });
}

// ------------------------------
// Exact Viewer helpers (unchanged behavior)
// ------------------------------
function hostKind(url){ if(/docs.google.com\/spreadsheets/i.test(url)) return 'Google Sheets'; if(/onedrive\.live\.com|office\.com|sharepoint\.com/i.test(url)) return 'OneDrive Excel'; return 'Other'; }

function analyzeGoogleUrl(u) {
  var params = u.searchParams;
  var gid = params.get('gid') || '0';
  var path = u.pathname;
  var isPub = /\/pubhtml$/.test(path) || /\/d\/e\//.test(path) || params.get('output') === 'html';
  var id = null;
  var dIndex = path.indexOf('/d/');
  if (dIndex !== -1) {
    var rest = path.slice(dIndex + 3);
    id = rest.split('/')[0] || null;
  }
  var embed;
  if (isPub) {
    var out = new URL(u.toString());
    if (!out.searchParams.has('widget')) out.searchParams.set('widget','true');
    if (!out.searchParams.has('headers')) out.searchParams.set('headers','false');
    if (!out.searchParams.has('gid')) out.searchParams.set('gid', gid);
    if (/\/pub$/.test(out.pathname) && out.searchParams.get('output')==='html') {
      out.pathname = out.pathname + 'html';
      out.searchParams.delete('output');
    }
    embed = out.toString();
  } else if (id) {
    embed = 'https://docs.google.com/spreadsheets/d/' + id + '/pubhtml?widget=true&headers=false&gid=' + encodeURIComponent(gid);
  } else {
    embed = '';
  }
  return { published: isPub, id: id, gid: gid, embed: embed };
}

function toEmbedUrl(raw){
  var url=(raw||'').trim();
  if(!url) return { embed:'', host:'', diagnostics:null, editUrl:'' };
  url = url.replace(/\s+/g,'').replace(/\u200b/g,'');
  try{
    var u = new URL(url);
    if (u.hostname.indexOf('docs.google.com')>-1 && u.pathname.indexOf('/spreadsheets/')>-1) {
      var diag = analyzeGoogleUrl(u);
      return { embed: diag.embed, host: 'Google Sheets', diagnostics: diag, editUrl: diag.id ? ('https://docs.google.com/spreadsheets/d/'+diag.id+'/edit?gid='+encodeURIComponent(diag.gid||'0')) : '' };
    }
    if (u.hostname.indexOf('onedrive.live.com')>-1){
      var resid = u.searchParams.get('resid'); var auth = u.searchParams.get('authkey');
      if(resid){
        var params = new URLSearchParams();
        params.set('resid', resid);
        if(auth) params.set('authkey', auth);
        params.set('em','2');
        params.set('wdAllowInteractivity','True');
        params.set('wdHideHeaders','True');
        return { embed: 'https://onedrive.live.com/embed?'+params.toString(), host:'OneDrive Excel', diagnostics:null, editUrl: url };
      }
      return { embed:'', host:'OneDrive Excel', diagnostics:null, editUrl: url };
    }
    if (u.hostname.indexOf('office.com')>-1 || u.hostname.indexOf('sharepoint.com')>-1)
      return { embed: url, host:'OneDrive Excel', diagnostics:null, editUrl: url };
    return { embed: url, host:'Other', diagnostics:null, editUrl: url };
  }catch(e){
    return { embed:'', host:'', diagnostics:null, editUrl:'' };
  }
}

function openExactView(url, title){
  var parsed = toEmbedUrl(url);
  var embed = parsed.embed, host = parsed.host, diagnostics = parsed.diagnostics, editUrl = parsed.editUrl;
  if(els.exactTitle) els.exactTitle.textContent = 'Exact Viewer — ' + (title||'');
  if(!embed){
    if(els.exactWarn) els.exactWarn.innerHTML = "Invalid URL. For Google Sheets: paste either a <b>Publish to web</b> link (File → Share → Publish to web) or a normal <code>/edit?gid=…</code> link and I'll convert it.";
    if(els.exactFrame) els.exactFrame.src = 'about:blank';
    openModal(els.exactModal,false);
    return;
  }
  if (host === 'Google Sheets' && diagnostics) {
    if (!diagnostics.published) {
      if(els.exactWarn) els.exactWarn.innerHTML = [
        "This is a normal share link, not a published one. Google only iframes published sheets.",
        "Steps: File → Share → Publish to web → Entire document → Publish. Then paste that link here.",
        "<small>Computed embed (works after publishing):</small>",
        "<small><code>"+diagnostics.embed+"</code></small>"
      ].join("<br/>");
    } else {
      if(els.exactWarn) els.exactWarn.textContent = "If it doesn't load, a domain policy may block embedding. Use 'Open in new tab'.";
    }
  } else {
    if(els.exactWarn) els.exactWarn.textContent = "If the sheet does not load: ensure it is shared for anyone-with-link and allows embedding.";
  }
  if(els.exactFrame) els.exactFrame.src = embed || 'about:blank';
  if(els.openInNewTabBtn) els.openInNewTabBtn.onclick = function(){ if(embed) window.open(embed,'_blank'); };
  var editBtn = document.getElementById('openEditBtn');
  if (editBtn){ editBtn.onclick = function(){ if (editUrl) { window.open(editUrl, '_blank'); } else { window.open(url, '_blank'); } }; }
  openModal(els.exactModal,false);
}

// ------------------------------
// Import/Export + Download self
// ------------------------------
async function exportAll(){ var games = await listGames(); var filesByGame = {}; var linksByGame = {}; 
  for(var i=0;i<games.length;i++){
    var g=games[i];
    var files = await listFiles(g.id);
    filesByGame[g.id] = await Promise.all(files.map(function(rec){
      return new Promise(function(res){
        var fr=new FileReader();
        fr.onload = function(){ res({ id:rec.id, name:rec.name, type:rec.type, size:rec.size, addedAt:rec.addedAt, exactUrl:rec.exactUrl||'', dataUrl:fr.result }); };
        fr.readAsDataURL(rec.blob);
      });
    }));
    var links = await listLinks(g.id);
    linksByGame[g.id] = links;
  }
  var payload = { meta:{ app:'GameSheets', version:'3.2-stable-adapt', exportedAt:Date.now() }, games:games, filesByGame:filesByGame, linksByGame:linksByGame };
  var blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
  downloadBlob('gamesheets-backup-'+ new Date().toISOString().slice(0,10) +'.json', blob);
}
async function importAll(file){
  var text = await file.text(); var data = JSON.parse(text);
  if(!data || !data.games) throw new Error('Invalid backup');
  await new Promise(function(res,rej){
    var t=db.transaction(['games','files','links'],'readwrite');
    t.objectStore('games').clear(); t.objectStore('files').clear(); t.objectStore('links').clear();
    t.oncomplete=res; t.onerror=function(){ rej(t.error); };
  });
  for(var i=0;i<data.games.length;i++){
    var g=data.games[i];
    await new Promise(function(res,rej){
      var r=tx('games','readwrite').add({ id:g.id, name:g.name });
      r.onsuccess=function(){ res(); }; r.onerror=function(){ rej(r.error); };
    });
  }
  if(data.filesByGame){
    for (var gid in data.filesByGame){
      var arr = data.filesByGame[gid]||[];
      for(var k=0;k<arr.length;k++){
        var f=arr[k]; var blob = dataURLtoBlob(f.dataUrl);
        await new Promise(function(res,rej){
          var r=tx('files','readwrite').add({ id:f.id, gameId:Number(gid), name:f.name, type:f.type, size:f.size, addedAt:f.addedAt, exactUrl:f.exactUrl||'', blob:blob });
          r.onsuccess=function(){ res(); }; r.onerror=function(){ rej(r.error); };
        });
      }
    }
  }
  if(data.linksByGame){
    for (var gid2 in data.linksByGame){
      var arr2 = data.linksByGame[gid2]||[];
      for(var m=0;m<arr2.length;m++){
        var l=arr2[m];
        await new Promise(function(res,rej){
          var r=tx('links','readwrite').add(l);
          r.onsuccess=function(){ res(); }; r.onerror=function(){ rej(r.error); };
        });
      }
    }
  }
  await refreshGames();
  if(currentGameId){ await refreshFiles(); await refreshLinks(); }
  alert('Import complete.');
}
function dataURLtoBlob(dataUrl){
  var parts = String(dataUrl).split(',');
  var head = parts[0] || ''; var body = parts[1] || '';
  var mimeMatch = head.match(/:(.*?);/);
  var mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  var bin = atob(body); var len = bin.length; var arr = new Uint8Array(len);
  for(var i=0;i<len;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type:mime});
}
function downloadSelf(){
  var doctype='<!DOCTYPE html>\n'; var html=document.documentElement.outerHTML;
  var blob=new Blob([doctype+html],{type:'text/html'});
  downloadBlob('game-sheets.html', blob);
}

// ------------------------------
// Modal helpers
// ------------------------------
function openModal(modal, lockScroll){
  if(!modal) return;
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  if(lockScroll) document.documentElement.style.overflow='hidden';
}
function closeModal(modal){
  if(!modal) return;
  modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
  document.documentElement.style.overflow='';
  if(modal===els.editorModal){
    // When closing the editor, persist any unsaved changes back to IndexedDB.
    // We first sync the in-memory matrix into the workbook sheet and then save the
    // updated workbook back into the current file record.  This ensures that
    // checkbox states and other edits are retained even if the user closes the
    // editor without explicitly clicking Save.
    try{
      if(currentWB && currentMatrix && currentFileRec && currentSheetName){
        syncMatrixIntoWorkbook();
        // Save back quietly without prompting.  Use the same logic as
        // saveBackToIndexedDB but suppress alerts to avoid spamming the user.
        var extension=ext(currentFileRec.name);
        var blob, mime;
        if(extension==='csv' || currentFileRec.type==='text/csv'){
          var csv=matrixToCSV(currentMatrix);
          blob = new Blob([csv],{type:'text/csv'});
          mime='text/csv';
        } else {
          var ab = XLSX.write(currentWB,{bookType:'xlsx', type:'array'});
          blob = new Blob([ab],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
          mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
        // Update the file record in IndexedDB
        getFile(currentFileRec.id).then(function(rec){
          rec.blob = blob; rec.type = mime; rec.size = blob.size;
          return putFile(rec).then(function(){ currentFileRec = rec; refreshFiles(); updateCurrentSheetProgress(); });
        }).catch(function(){ /* ignore errors */ });
      }
    }catch(e){ /* ignore errors */ }
    if(els.editorBody) els.editorBody.replaceChildren();
    if(els.sheetTabs) els.sheetTabs.replaceChildren();
    currentWB=null; currentMatrix=null; currentFileRec=null; currentSheetName=null; currentWS=null; currentAdapt=null;
  }
  if(modal===els.exactModal){ if(els.exactFrame) els.exactFrame.src='about:blank'; }
}

// ------------------------------
// Init + event wiring
// ------------------------------
async function init(){
  try{
    mapEls();
    try{ db = await openDB(); }catch(err){ alert('IndexedDB is blocked or unsupported. Local files will not be saved.'); }
    await refreshGames();
    setGameEnabled(false);

    // Add game
    if(els.addGameBtn) els.addGameBtn.addEventListener('click', async function(){
      var name = els.newGameName ? els.newGameName.value : '';
      if(!name || !name.trim()) return;
      var id = await addGame(name.trim());
      if(els.newGameName) els.newGameName.value='';
      await refreshGames(); await selectGame(id);
    });
    if(els.newGameName) els.newGameName.addEventListener('keydown', function(e){ if(e.key==='Enter' && els.addGameBtn){ els.addGameBtn.click(); } });

    // Upload local files
    if(els.uploadBtn) els.uploadBtn.addEventListener('click', function(){ if(!currentGameId) return; if(els.fileInput) els.fileInput.click(); });
    if(els.fileInput) els.fileInput.addEventListener('change', async function(){
      if(!currentGameId || !els.fileInput.files || !els.fileInput.files.length) return;
      await addFiles(currentGameId, els.fileInput.files);
      els.fileInput.value='';
      await refreshFiles(); await refreshGames();
    });

    // Game actions
    if(els.renameGameBtn) els.renameGameBtn.addEventListener('click', async function(){
      if(!currentGameId) return;
      var g = await getGame(currentGameId);
      var name = prompt('Rename game:', (g && g.name) || '');
      if(!name) return;
      await renameGame(currentGameId, name);
      await refreshGames(); selectGame(currentGameId);
    });
    if(els.deleteGameBtn) els.deleteGameBtn.addEventListener('click', async function(){
      if(!currentGameId) return;
      var g = await getGame(currentGameId);
      if(confirm('Delete "'+((g&&g.name)||'this game')+'" and all its files/links? This cannot be undone.')){
        await deleteGame(currentGameId);
        currentGameId = null; showNoGame();
      }
    });

    // Filters
    if(els.search) els.search.addEventListener('input', refreshFiles);

    // Online links
    if(els.addLinkBtn) els.addLinkBtn.addEventListener('click', async function(){
      if(!currentGameId) return;
      var name = (els.newLinkName && els.newLinkName.value || '').trim();
      var url  = (els.newLinkUrl && els.newLinkUrl.value || '').trim();
      if(!name || !url) return;
      await addLink(currentGameId, name, url);
      if(els.newLinkName) els.newLinkName.value='';
      if(els.newLinkUrl) els.newLinkUrl.value='';
      await refreshLinks();
    });

    // Export / Import / Download
    if(els.exportBtn) els.exportBtn.addEventListener('click', exportAll);
    if(els.importBtn) els.importBtn.addEventListener('click', function(){ if(els.importFile) els.importFile.click(); });
    if(els.importFile) els.importFile.addEventListener('change', async function(){
      var f = els.importFile.files && els.importFile.files[0];
      if(!f) return;
      try{ await importAll(f); }catch(e){ alert('Import failed: '+ e.message); } finally { els.importFile.value=''; }
    });
    if(els.downloadHtmlBtn) els.downloadHtmlBtn.addEventListener('click', downloadSelf);

    // Editor modal wiring
    if(els.closeEditor) els.closeEditor.addEventListener('click', function(){ closeModal(els.editorModal); });
    var editorModalEl = document.getElementById('editorModal');
    if(editorModalEl) editorModalEl.addEventListener('click', function(e){ if(e.target && e.target.id==='editorModal') closeModal(els.editorModal); });
    if(els.addRowBtn) els.addRowBtn.addEventListener('click', addRow);
    if(els.saveBtn) els.saveBtn.addEventListener('click', function(){ try{ saveBackToIndexedDB(); }catch(e){ alert('Save failed: '+e.message); } });
    if(els.exportCsvBtn) els.exportCsvBtn.addEventListener('click', function(){
      var csv=matrixToCSV(currentMatrix||[]);
      downloadBlob(String((currentFileRec && currentFileRec.name) || 'sheet').replace(/\.[^.]+$/, '')+'.csv', new Blob([csv],{type:'text/csv'}));
    });
    if(els.exportXlsxBtn) els.exportXlsxBtn.addEventListener('click', function(){
      syncMatrixIntoWorkbook();
      var ab=XLSX.write(currentWB,{bookType:'xlsx',type:'array'});
      downloadBlob(String((currentFileRec && currentFileRec.name) || 'workbook').replace(/\.[^.]+$/, '')+'.xlsx', new Blob([ab],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    });

    // Exact viewer modal wiring
    if(els.closeExact) els.closeExact.addEventListener('click', function(){ closeModal(els.exactModal); });
    var exactModalEl = document.getElementById('exactModal');
    if(exactModalEl) exactModalEl.addEventListener('click', function(e){ if(e.target && e.target.id==='exactModal') closeModal(els.exactModal); });

    console.log('[GameSheets] init complete (stable-adapt)');
  }catch(err){
    console.error('Init failed:', err);
    alert('A script error stopped the UI. Check console for details: '+err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);



/* === Gamesheets Sorting Upgrade (v1.1) === */
(function(){
  if (window.__gsSortingInstalled) return;
  window.__gsSortingInstalled = true;

  window._gsSort = window._gsSort || {};

  function _inferSortType(colStats, colIdx, headerText){
    if(colStats && colStats[colIdx] && colStats[colIdx].booleanLikeRatio >= 0.7) return 'completed';
    if(headerText && /done|complete|completed|status|check(ed)?/i.test(headerText)) return 'completed';
    if(colStats && colStats[colIdx] && colStats[colIdx].numericRatio >= 0.7) return 'numeric';
    return 'alpha';
  }
  function _normalizeBooleanLike(v){
    if (v === true || v === false) return v ? 1 : 0;
    if (v == null) return -1;
    var s = (''+v).trim().toLowerCase();
    if (s === '' ) return -1;
    if (/^(true|yes|y|x|✓|✔|done|completed|1)$/i.test(s)) return 1;
    if (/^(false|no|n|0)$/i.test(s)) return 0;
    return -1;
  }
  function _coerceNumeric(v){
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    var s = (''+v).replace(/[$,]/g,'').trim();
    if (s === '') return NaN;
    var num = parseFloat(s);
    return isFinite(num) ? num : NaN;
  }
  function _coerceAlpha(v){
    if (v == null) return '';
    return (''+v).toLowerCase();
  }
  function _stableSort(array, cmp){
    return array
      .map(function(v, idx){ return {v:v, i:idx}; })
      .sort(function(a,b){ var c = cmp(a.v, b.v); return c || (a.i - b.i); })
      .map(function(o){ return o.v; });
  }
  function _computeColStatsForSort(matrix){
    var cols = 0;
    for(var r=0; r<matrix.length; r++){ cols = Math.max(cols, (matrix[r]||[]).length); }
    var stats = [];
    for(var c=0; c<cols; c++){
      var total=0, bools=0, nums=0;
      for(var r=1; r<matrix.length; r++){
        var row = matrix[r]||[];
        var v = (row[c] != null) ? row[c] : '';
        if((''+v).trim() === '') continue;
        total++;
        if(_normalizeBooleanLike(v) !== -1) bools++;
        if(!isNaN(_coerceNumeric(v))) nums++;
      }
      var ratio = total>0 ? (bools/total) : 0;
      var nratio = total>0 ? (nums/total) : 0;
      stats[c] = { booleanLikeRatio: ratio, numericRatio: nratio };
    }
    return stats;
  }
  function _findSectionHeaderRows(matrix){
    var rows = [];
    for(var r=1; r<matrix.length; r++){
      try { if (isSectionHeaderRow(matrix, r, null, null)) rows.push(r); }
      catch(e){
        var nonEmpty = 0;
        var row = matrix[r]||[];
        for(var c=0;c<row.length;c++){ if(row[c] !== '' && row[c] != null) nonEmpty++; }
        if (nonEmpty <= 2) rows.push(r);
      }
    }
    return rows;
  }
  function _sortRowsSlice(matrix, startRow, endRow, colIdx, type, dir){
    var body = matrix.slice(startRow, endRow);
    var cmp;
    if(type === 'completed'){
      cmp = function(A,B){
        var a = _normalizeBooleanLike((A||[])[colIdx]);
        var b = _normalizeBooleanLike((B||[])[colIdx]);
        if(a === b) return 0;
        return (a < b ? -1 : 1);
      };
    } else if(type === 'numeric'){
      cmp = function(A,B){
        var a = _coerceNumeric((A||[])[colIdx]);
        var b = _coerceNumeric((B||[])[colIdx]);
        if(isNaN(a) && isNaN(b)) return 0;
        if(isNaN(a)) return 1;
        if(isNaN(b)) return -1;
        return a - b;
      };
    } else { // alpha
      cmp = function(A,B){
        var a = _coerceAlpha((A||[])[colIdx]);
        var b = _coerceAlpha((B||[])[colIdx]);
        if(a === b) return 0;
        return a < b ? -1 : 1;
      };
    }
    var sorted = _stableSort(body, cmp);
    if(dir === 'desc') sorted.reverse();
    for(var i=0; i<sorted.length; i++){
      matrix[startRow + i] = sorted[i];
    }
  }
  function sortMatrixInPlace(matrix, options){
    options = options || {};
    var colIdx = options.col|0;
    var dir = options.dir === 'desc' ? 'desc' : 'asc';
    var scope = options.scope === 'sheet' ? 'sheet' : 'sections';
    var headerText = (matrix[0] && matrix[0][colIdx]) ? (''+matrix[0][colIdx]) : '';
    var stats = _computeColStatsForSort(matrix);
    var type = (options.type && /^(alpha|numeric|completed)$/.test(options.type)) ? options.type : _inferSortType(stats, colIdx, headerText);

    if(scope === 'sheet'){
      _sortRowsSlice(matrix, 1, matrix.length, colIdx, type, dir);
    } else {
      var secIdxs = _findSectionHeaderRows(matrix);
      if(secIdxs.length === 0){
        _sortRowsSlice(matrix, 1, matrix.length, colIdx, type, dir);
      } else {
        var bounds = [];
        var prev = 1;
        for(var i=0;i<secIdxs.length;i++){
          var sec = secIdxs[i];
          if(sec > prev) { bounds.push([prev, sec]); }
          prev = sec + 1;
        }
        if(prev < matrix.length) bounds.push([prev, matrix.length]);
        bounds.forEach(function(b){ _sortRowsSlice(matrix, b[0], b[1], colIdx, type, dir); });
      }
    }
    return { col: colIdx, dir: dir, type: type, scope: scope };
  }

  // decorate renderMatrix safely
  if (typeof renderMatrix === 'function'){
    var _origRenderMatrix = renderMatrix;
    renderMatrix = function(matrix, adapt){
      var tbl = _origRenderMatrix(matrix, adapt);
      try {
        // remember current for quick rerender
        window._activeMatrix = matrix;
        window._activeAdapt = adapt;

        var thead = tbl && tbl.querySelector ? tbl.querySelector('thead') : null;
        if (!thead) return tbl;

        // apply indicator
        var currentSheetKey = (window._currentSheetKey || 'default');
        var s = window._gsSort[currentSheetKey];
        var ths = thead.querySelectorAll('th');
        ths.forEach(function(th, i){
          th.classList.remove('sorted-asc'); th.classList.remove('sorted-desc');
          if(s && i === s.col){ th.classList.add(s.dir === 'desc' ? 'sorted-desc' : 'sorted-asc'); }
          th.style.cursor = 'pointer';
          th.onclick = function(){
            var state = (window._gsSort[currentSheetKey] && window._gsSort[currentSheetKey].col === i) ? window._gsSort[currentSheetKey] : null;
            var nextDir = state ? (state.dir === 'asc' ? 'desc' : (state.dir === 'desc' ? null : 'asc')) : 'asc';
            if(!nextDir){
              delete window._gsSort[currentSheetKey];
              if(typeof window._rerenderCurrentSheet === 'function'){ window._rerenderCurrentSheet(); }
              return;
            }
            var result = sortMatrixInPlace(matrix, { col: i, dir: nextDir, scope: 'sections' });
            window._gsSort[currentSheetKey] = result;
            if(typeof window._rerenderCurrentSheet === 'function'){ window._rerenderCurrentSheet(); }
          };
        });
      } catch(e){ console.warn('Sorting adornment failed:', e); }
      return tbl;
    };
  }

  if (typeof window._rerenderCurrentSheet !== 'function'){
    window._rerenderCurrentSheet = function(){
      try {
        var host = document.getElementById('tableHost');
        if(!host) return;
        host.innerHTML = '';
        if (window._activeMatrix && typeof renderMatrix === 'function'){
          var tbl = renderMatrix(window._activeMatrix, window._activeAdapt || null);
          host.appendChild(tbl);
        }
      } catch(e){ console.warn('rerender failed', e); }
    };
  }
})();


/* =========================================================
   GameSheets — Persistent Storage Add-on (inline)
   - IndexedDB helper (StorageGS)
   - Service worker registration
   - Hooks into saveBackToIndexedDB() and editor close
   ========================================================= */
(function(){
  // ---- StorageGS (inline version of storage.js) ----
  const DB_NAME = 'gamesheets';
  const DB_VERSION = 1;
  const STORES = { files: 'files', settings: 'settings' };
  let _db;
  function openDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains(STORES.files)){
          db.createObjectStore(STORES.files, { keyPath: 'id' });
        }
        if(!db.objectStoreNames.contains(STORES.settings)){
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }
  async function db(){ if(_db) return _db; _db = await openDB(); return _db; }
  async function put(storeName, val){
    const d = await db();
    return new Promise((resolve, reject)=>{
      const tx = d.transaction(storeName, 'readwrite');
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
      tx.objectStore(storeName).put(val);
    });
  }
  async function get(storeName, key){
    const d = await db();
    return new Promise((resolve, reject)=>{
      const tx = d.transaction(storeName, 'readonly');
      tx.onerror = ()=> reject(tx.error);
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> reject(req.error);
    });
  }
  async function list(storeName){
    const d = await db();
    return new Promise((resolve, reject)=>{
      const tx = d.transaction(storeName, 'readonly');
      tx.onerror = ()=> reject(tx.error);
      const out = [];
      const req = tx.objectStore(storeName).openCursor();
      req.onsuccess = (e)=>{
        const cursor = e.target.result;
        if(cursor){ out.push(cursor.value); cursor.continue(); }
        else resolve(out);
      };
      req.onerror = ()=> reject(req.error);
    });
  }
  async function del(storeName, key){
    const d = await db();
    return new Promise((resolve, reject)=>{
      const tx = d.transaction(storeName, 'readwrite');
      tx.onerror = ()=> reject(tx.error);
      tx.oncomplete = ()=> resolve(true);
      tx.objectStore(storeName).delete(key);
    });
  }
  window.StorageGS = {
    async saveFile(rec){
      if(!(rec && rec.id)) throw new Error('saveFile requires rec.id');
      const to = Object.assign({}, rec);
      if(to.data && to.data.buffer){ to.data = to.data.buffer.slice(0); }
      return put(STORES.files, to);
    },
    async loadFile(id){ return get(STORES.files, id); },
    async listFiles(){ return list(STORES.files); },
    async removeFile(id){ return del(STORES.files, id); },
    async setSetting(key, value){ return put(STORES.settings, { key, value }); },
    async getSetting(key){ const r = await get(STORES.settings, key); return r ? r.value : null; },
    async listSettings(){ return list(STORES.settings); },
    async autosaveWorkbook({ id, name, type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer, meta }){
      const rec = { id, name, type, size: arrayBuffer ? arrayBuffer.byteLength : 0, modified: Date.now(), data: arrayBuffer, meta: meta || {} };
      await window.StorageGS.saveFile(rec);
      await window.StorageGS.setSetting('last_open', { id, when: Date.now() });
      return true;
    }
  };

  // ---- Service worker registration (safe no-op if missing) ----
  try{
    if('serviceWorker' in navigator){
      window.addEventListener('load', function(){
        navigator.serviceWorker.register('./sw.js').catch(function(){});
      });
    }
  }catch(_e){}

  // ---- Hook saveBackToIndexedDB to also autosave via StorageGS ----
  try{
    if(typeof saveBackToIndexedDB === 'function'){
      const _origSave = saveBackToIndexedDB;
      window.saveBackToIndexedDB = function(){
        // call original first
        try { _origSave(); } catch(e) { console.error(e); }
        try{
          if(window.currentWB && window.currentFileRec && typeof XLSX !== 'undefined'){
            // Ensure workbook is up-to-date
            if(typeof syncMatrixIntoWorkbook === 'function') syncMatrixIntoWorkbook();
            const ab = XLSX.write(window.currentWB, { bookType:'xlsx', type:'array' });
            window.StorageGS.autosaveWorkbook({
              id: window.currentFileRec.id,
              name: window.currentFileRec.name,
              arrayBuffer: ab,
              meta: { sheet: window.currentSheetName || '', ts: Date.now() }
            });
          }
        }catch(e){ console.warn('[StorageGS] autosave failed:', e.message); }
      };
    }
  }catch(_e){}

  // ---- Persist on sheet switch as well (best-effort) ----
  try{
    if(typeof syncMatrixIntoWorkbook === 'function'){
      const _sync = syncMatrixIntoWorkbook;
      window.syncMatrixIntoWorkbook = function(){
        const r = _sync.apply(this, arguments);
        try{
          if(window.currentWB && window.currentFileRec && typeof XLSX !== 'undefined'){
            const ab = XLSX.write(window.currentWB, { bookType:'xlsx', type:'array' });
            window.StorageGS.autosaveWorkbook({
              id: window.currentFileRec.id,
              name: window.currentFileRec.name,
              arrayBuffer: ab,
              meta: { sheet: window.currentSheetName || '', ts: Date.now() }
            });
          }
        }catch(e){ /* silent */ }
        return r;
      };
    }
  }catch(_e){}
})();