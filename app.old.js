/*
  JavaScript extracted from the inline version. Fixed prior SyntaxError by:
  - Avoiding stray/unescaped newlines in strings
  - Ensuring no truncated functions remain
  - Using DOMContentLoaded to bind events after DOM is ready
*/

// ------------------------------
// IndexedDB setup (games, files, links)
// ------------------------------
const DB_NAME = 'GameSheetsDB';
const DB_VERSION = 2; // links store
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('games')){
        const games = db.createObjectStore('games', { keyPath:'id', autoIncrement:true });
        games.createIndex('name','name',{unique:false});
      }
      if(!db.objectStoreNames.contains('files')){
        const files = db.createObjectStore('files', { keyPath:'id', autoIncrement:true });
        files.createIndex('byGame','gameId',{unique:false});
        files.createIndex('byName','name',{unique:false});
      }
      if(!db.objectStoreNames.contains('links')){
        const links = db.createObjectStore('links', { keyPath:'id', autoIncrement:true });
        links.createIndex('byGame','gameId',{unique:false});
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

function tx(store, mode='readonly'){
  const t = db.transaction(store, mode); return t.objectStore(store);
}

// ------------------------------
// Games
// ------------------------------
async function addGame(name){ name=name.trim(); if(!name) return null; return new Promise((res,rej)=>{ const req=tx('games','readwrite').add({ name }); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
async function listGames(){ return new Promise((res,rej)=>{ const out=[]; const req=tx('games').openCursor(); req.onsuccess=e=>{ const cur=e.target.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out)}; req.onerror=()=>rej(req.error); }); }
async function getGame(id){ return new Promise((res,rej)=>{ const req=tx('games').get(id); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
async function renameGame(id, name){ const g=await getGame(id); if(!g) return; g.name=name.trim(); return new Promise((res,rej)=>{ const req=tx('games','readwrite').put(g); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }
async function deleteGame(id){ const files = await listFiles(id); for(const f of files){ await deleteFile(f.id); } const links = await listLinks(id); for(const l of links){ await deleteLink(l.id); } return new Promise((res,rej)=>{ const req=tx('games','readwrite').delete(id); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }

// ------------------------------
// Files (local uploads)
// ------------------------------
async function addFiles(gameId, fileList){ const store=tx('files','readwrite'); await Promise.all(Array.from(fileList).map(file=>new Promise((res,rej)=>{ const now=Date.now(); const rec={ gameId, name:file.name, type:file.type||guessType(file.name), size:file.size, addedAt:now, blob:file, exactUrl:'' }; const req=store.add(rec); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }))); }
function listFiles(gameId){ return new Promise((res,rej)=>{ const out=[]; const idx=tx('files').index('byGame'); const range=IDBKeyRange.only(gameId); const req=idx.openCursor(range); req.onsuccess=e=>{ const cur=e.target.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out)}; req.onerror=()=>rej(req.error); }); }
function getFile(id){ return new Promise((res,rej)=>{ const req=tx('files').get(id); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function putFile(rec){ return new Promise((res,rej)=>{ const req=tx('files','readwrite').put(rec); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }
function updateFileName(id,name){ return new Promise((res,rej)=>{ const store=tx('files','readwrite'); const get=store.get(id); get.onsuccess=()=>{ const rec=get.result; if(!rec) return res(); rec.name=name; const put=store.put(rec); put.onsuccess=()=>res(); put.onerror=()=>rej(put.error); }; get.onerror=()=>rej(get.error); }); }
function updateFileExactUrl(id,url){ return new Promise((res,rej)=>{ const store=tx('files','readwrite'); const get=store.get(id); get.onsuccess=()=>{ const rec=get.result; if(!rec) return res(); rec.exactUrl=url; const put=store.put(rec); put.onsuccess=()=>res(); put.onerror=()=>rej(put.error); }; get.onerror=()=>rej(get.error); }); }
function deleteFile(id){ return new Promise((res,rej)=>{ const req=tx('files','readwrite').delete(id); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }

// ------------------------------
// Links (standalone online spreadsheets)
// ------------------------------
async function addLink(gameId, name, url){ name=name.trim(); url=url.trim(); if(!name||!url) return; return new Promise((res,rej)=>{ const req=tx('links','readwrite').add({ gameId, name, url, addedAt:Date.now() }); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function listLinks(gameId){ return new Promise((res,rej)=>{ const out=[]; const idx=tx('links').index('byGame'); const req=idx.openCursor(IDBKeyRange.only(gameId)); req.onsuccess=e=>{ const cur=e.target.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out) }; req.onerror=()=>rej(req.error); }); }
function deleteLink(id){ return new Promise((res,rej)=>{ const req=tx('links','readwrite').delete(id); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }

// ------------------------------
// Utilities
// ------------------------------
function downloadBlob(name,blob){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function humanSize(n){ if(n<1024) return n+' B'; const kb=n/1024; if(kb<1024) return kb.toFixed(1)+' KB'; const mb=kb/1024; if(mb<1024) return mb.toFixed(2)+' MB'; const gb=mb/1024; return gb.toFixed(2)+' GB'; }
function guessType(name){ const low=name.toLowerCase(); if(low.endsWith('.csv')) return 'text/csv'; if(low.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; if(low.endsWith('.xls')) return 'application/vnd.ms-excel'; if(low.endsWith('.ods')) return 'application/vnd.oasis.opendocument.spreadsheet'; return 'application/octet-stream'; }
function ext(name){ const i=name.lastIndexOf('.'); return i>-1? name.slice(i+1).toLowerCase():'' }

// ------------------------------
// UI State
// ------------------------------
let currentGameId = null;
let currentWB = null, currentSheetName = null, currentMatrix = null, currentFileRec = null;

const els = {};
function mapEls(){
  const ids = ['games','newGameName','addGameBtn','gameTitle','fileCount','gameHelp','renameGameBtn','deleteGameBtn','search','uploadBtn','fileInput','fileBody','linksBody','newLinkName','newLinkUrl','addLinkBtn','exportBtn','importBtn','importFile','downloadHtmlBtn','editorModal','editorTitle','editorMeta','editorBody','sheetTabs','smartControls','addRowBtn','saveBtn','exportCsvBtn','exportXlsxBtn','closeEditor','exactModal','exactTitle','exactFrame','exactWarn','closeExact','openInNewTabBtn','uploadPanel','linksPanel'];
  ids.forEach(id=> els[id] = document.getElementById(id));
}

function setGameEnabled(enabled){ els.uploadBtn.disabled = !enabled; els.renameGameBtn.disabled = !enabled; els.deleteGameBtn.disabled = !enabled; els.addLinkBtn.disabled = !enabled; els.uploadPanel.setAttribute('aria-disabled', String(!enabled)); els.linksPanel.setAttribute('aria-disabled', String(!enabled)); els.gameHelp.textContent = enabled ? 'Upload spreadsheets or add Exact View links for this game.' : 'Select or create a game on the left to begin.'; }

async function refreshGames(){ const list = await listGames(); const children=[]; for(const g of list){ const files = await listFiles(g.id); const btn = document.createElement('button'); btn.className='game' + (g.id===currentGameId?' active':''); btn.dataset.id=g.id; const ico=document.createElement('div'); ico.className='pill'; ico.textContent='🎮'; btn.appendChild(ico); const nm=document.createElement('div'); nm.className='name'; nm.textContent=g.name; btn.appendChild(nm); const meta=document.createElement('div'); meta.className='meta'; meta.textContent=`${files.length}`; btn.appendChild(meta); btn.addEventListener('click',()=> selectGame(g.id)); children.push(btn);} els.games.replaceChildren(...children); if(currentGameId && !list.find(g=>g.id===currentGameId)){ currentGameId=null; showNoGame(); } }

async function selectGame(id){ currentGameId=id; const g=await getGame(id); if(!g){ showNoGame(); return; } els.gameTitle.textContent=g.name; setGameEnabled(true); await refreshFiles(); await refreshLinks(); await refreshGames(); }
function showNoGame(){ els.gameTitle.textContent='No game selected'; els.fileBody.innerHTML = `<tr><td colspan="6" class="muted">No files yet.</td></tr>`; els.linksBody.innerHTML = `<tr><td colspan="4" class="muted">No links yet.</td></tr>`; els.fileCount.textContent='0 files'; setGameEnabled(false); refreshGames(); }

async function refreshFiles(){ if(!currentGameId){ showNoGame(); return; } let files = await listFiles(currentGameId); const q = els.search.value.trim().toLowerCase(); if(q) files = files.filter(f=>f.name.toLowerCase().includes(q)); els.fileCount.textContent = `${files.length} ${files.length===1?'file':'files'}`; if(files.length===0){ els.fileBody.innerHTML = `<tr><td colspan="6" class="muted">No files yet.</td></tr>`; return; } const rows = files.map(rec=>{ const tr=document.createElement('tr');
  const tdName=document.createElement('td'); const nameInput=document.createElement('input'); nameInput.type='text'; nameInput.value=rec.name; nameInput.style.width='100%'; nameInput.addEventListener('change', async ()=>{ await updateFileName(rec.id, nameInput.value.trim()||rec.name); refreshFiles(); }); tdName.appendChild(nameInput);
  const tdType=document.createElement('td'); tdType.textContent = rec.type||'–';
  const tdSize=document.createElement('td'); tdSize.textContent = humanSize(rec.size);
  const tdDate=document.createElement('td'); tdDate.textContent = new Date(rec.addedAt).toLocaleString();
  const tdUrl=document.createElement('td'); const urlInput=document.createElement('input'); urlInput.type='text'; urlInput.placeholder='Optional: paste Google/OneDrive link for Exact View'; urlInput.value = rec.exactUrl||''; urlInput.addEventListener('change', async ()=>{ await updateFileExactUrl(rec.id, urlInput.value.trim()); }); tdUrl.appendChild(urlInput);
  const tdAct=document.createElement('td');
  const openBtn=document.createElement('button'); openBtn.className='btn secondary'; openBtn.textContent='Open'; openBtn.title='Open offline editor'; openBtn.addEventListener('click',()=> openEditor(rec));
  const exactBtn=document.createElement('button'); exactBtn.className='btn'; exactBtn.textContent='Exact View'; exactBtn.title='Open pixel-perfect view (needs valid link)'; exactBtn.addEventListener('click',()=> openExactView(rec.exactUrl||'', rec.name));
  const dlBtn=document.createElement('button'); dlBtn.className='btn secondary'; dlBtn.textContent='Download'; dlBtn.addEventListener('click',()=> downloadBlob(rec.name, rec.blob));
  const delBtn=document.createElement('button'); delBtn.className='btn secondary danger'; delBtn.textContent='Delete'; delBtn.addEventListener('click', async ()=>{ await deleteFile(rec.id); refreshFiles(); refreshGames(); });
  tdAct.append(openBtn,' ', exactBtn,' ', dlBtn,' ', delBtn);
  tr.append(tdName, tdType, tdSize, tdDate, tdUrl, tdAct); return tr; }); els.fileBody.replaceChildren(...rows); }

async function refreshLinks(){ if(!currentGameId){ return; } const list = await listLinks(currentGameId); if(list.length===0){ els.linksBody.innerHTML = `<tr><td colspan="4" class="muted">No links yet.</td></tr>`; return; } const rows = list.map(link=>{ const tr=document.createElement('tr'); const tdN=document.createElement('td'); tdN.textContent = link.name;
  const tdH=document.createElement('td'); tdH.textContent = hostKind(link.url);
  const tdU=document.createElement('td'); const i=document.createElement('input'); i.type='text'; i.style.width='100%'; i.value=link.url; i.addEventListener('change', async()=>{ await addLink(currentGameId, link.name, i.value) }); tdU.appendChild(i);
  const tdA=document.createElement('td'); const view=document.createElement('button'); view.className='btn'; view.textContent='Exact View'; view.addEventListener('click', ()=> openExactView(link.url, link.name)); const del=document.createElement('button'); del.className='btn secondary danger'; del.textContent='Delete'; del.addEventListener('click', async()=>{ await deleteLink(link.id); refreshLinks(); }); tdA.append(view,' ',del);
  tr.append(tdN, tdH, tdU, tdA); return tr; }); els.linksBody.replaceChildren(...rows); }

// ------------------------------
// Offline Editor
// ------------------------------
function openEditor(rec){ els.editorTitle.textContent = rec.name; els.editorMeta.textContent = `${rec.type || 'unknown'} • ${humanSize(rec.size)}`; currentFileRec = rec; const extension = ext(rec.name); (async()=>{ try{ if(extension==='csv' || rec.type==='text/csv'){ const text = await rec.blob.text(); const rows = csvToMatrix(text); currentWB = XLSX.utils.book_new(); currentMatrix = rows; currentSheetName='Sheet1'; const ws = XLSX.utils.aoa_to_sheet(rows); XLSX.utils.book_append_sheet(currentWB, ws, currentSheetName); renderSheetTabs([currentSheetName]); renderMatrix(currentMatrix); openModal(els.editorModal,true); return; } const buf = await rec.blob.arrayBuffer(); currentWB = XLSX.read(buf,{type:'array'}); const names=currentWB.SheetNames; currentSheetName=names[0]; currentMatrix = XLSX.utils.sheet_to_json(currentWB.Sheets[currentSheetName], { header:1, blankrows:true, defval:'' }); renderSheetTabs(names); renderMatrix(currentMatrix); openModal(els.editorModal,true); }catch(err){ alert('Open failed. You can still download the file.\n'+err.message); } })(); }

function renderSheetTabs(names){ els.sheetTabs.replaceChildren(); names.forEach(name=>{ const b=document.createElement('button'); b.textContent=name; if(name===currentSheetName) b.classList.add('active'); b.addEventListener('click',()=>{ currentSheetName=name; currentMatrix = XLSX.utils.sheet_to_json(currentWB.Sheets[name], { header:1, blankrows:true, defval:'' }); renderSheetTabs(names); renderMatrix(currentMatrix); }); els.sheetTabs.appendChild(b); }); }

function csvToMatrix(text){ return text.split(/\r?\n/).map(line=> line? line.split(/,(?=(?:[^\"]*\"[^\"]*\")[^\"]*$)/).map(c=> stripQuotes(c)) : ['']); }
function matrixToCSV(matrix){ return matrix.map(row=> row.map(cell=>{ const s = cell==null? '' : String(cell); if(/[",\n]/.test(s)) return '"'+ s.replace(/"/g,'""') +'"'; return s; }).join(',')).join('\n'); }
function stripQuotes(s){ if(s==null) return ''; s=String(s); if(s.startsWith('"') && s.endsWith('"')) return s.slice(1,-1).replace(/""/g,'"'); return s; }
function headerRow(matrix){ return matrix.length? matrix[0] : []; }
function uniqueValuesByCol(matrix, col){ const set=new Set(); for(let r=1;r<matrix.length;r++){ const v = matrix[r]?.[col]; if(v!=='' && v!=null) set.add(String(v)); if(set.size>12) break; } return Array.from(set); }
function isBooleanLike(v){ if(typeof v==='boolean') return true; const s=String(v).trim().toLowerCase(); return s==='true'||s==='false'||s==='yes'||s==='no'||s==='y'||s==='n'||s==='1'||s==='0'||s==='☑'||s==='☐'; }
function normalizeBool(v){ const s=String(v).trim().toLowerCase(); return (s==='true'||s==='yes'||s==='y'||s==='1'||s==='☑'); }

function autosizeColumns(matrix){ const rows=matrix||[]; const cols=Math.max(...rows.map(r=>r.length),1); const widths=new Array(cols).fill(0); for(let c=0;c<cols;c++){ let maxLen=0; for(let r=0;r<rows.length;r++){ const val=rows[r]?.[c]; const txt=(val==null?'':String(val)); const est=txt.length + ((txt.match(/[MW@#]/g)||[]).length)*0.4; if(est>maxLen)maxLen=est; if(maxLen>80)break; } const minCh=8, maxCh=36; const ch=Math.min(Math.max(Math.ceil(maxLen*0.9+2),minCh),maxCh); widths[c]=ch; } return widths; }

function renderMatrix(matrix){ const table=document.createElement('table'); table.className='table'; const widths=autosizeColumns(matrix); const colgroup=document.createElement('colgroup'); widths.forEach(w=>{ const col=document.createElement('col'); col.style.width=w+'ch'; colgroup.appendChild(col); }); table.appendChild(colgroup); const thead=document.createElement('thead'); thead.className='thead'; const trh=document.createElement('tr'); const cols=Math.max(...matrix.map(r=>r.length),1); for(let c=0;c<cols;c++){ const th=document.createElement('th'); th.textContent=headerRow(matrix)[c]??''; trh.appendChild(th); } thead.appendChild(trh); const tbody=document.createElement('tbody'); for(let r=1;r<matrix.length;r++){ const tr=document.createElement('tr'); for(let c=0;c<cols;c++){ const td=document.createElement('td'); td.className='cell'; const v=matrix[r]?.[c]??''; const useSmart=els.smartControls.checked; const uniques = useSmart? uniqueValuesByCol(matrix,c):[]; if(useSmart && isBooleanLike(v) && uniques.length<=2){ const wrap=document.createElement('div'); wrap.className='cell-checkbox'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=normalizeBool(v); cb.addEventListener('change',()=>{ matrix[r][c] = cb.checked? 'TRUE':'FALSE'; }); wrap.appendChild(cb); td.appendChild(wrap); } else if(useSmart && uniques.length>0 && uniques.length<=10){ const sel=document.createElement('select'); sel.className='cell-select'; const emptyOpt=document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent=''; sel.appendChild(emptyOpt); uniques.forEach(u=>{ const o=document.createElement('option'); o.value=u; o.textContent=u; sel.appendChild(o); }); sel.value=String(v); sel.addEventListener('change',()=>{ matrix[r][c] = sel.value; }); td.appendChild(sel); } else { const str=String(v); if(str.includes('\n') || str.length>30){ const ta=document.createElement('textarea'); ta.className='cell-textarea'; ta.value=str; ta.rows=5; autoResizeTA(ta); ta.addEventListener('input',()=>{ autoResizeTA(ta); matrix[r][c]=ta.value; }); td.appendChild(ta); } else { const inp=document.createElement('input'); inp.className='cell-input'; inp.type=(str!=='' && !isNaN(Number(str)))? 'number':'text'; inp.value=str; inp.addEventListener('change',()=>{ matrix[r][c]= inp.type==='number' && inp.value!=='' ? Number(inp.value): inp.value; }); td.appendChild(inp); } } tr.appendChild(td); } tbody.appendChild(tr); } if(matrix.length<=1){ const tr=document.createElement('tr'); const cols=Math.max(1, headerRow(matrix).length); for(let c=0;c<cols;c++){ const td=document.createElement('td'); const ta=document.createElement('textarea'); ta.className='cell-textarea'; ta.rows=5; ta.value=''; ta.addEventListener('input',()=>{ if(!matrix[1]) matrix[1]=[]; matrix[1][c]=ta.value; }); td.appendChild(ta); tr.appendChild(td);} tbody.appendChild(tr);} table.append(thead,tbody); els.editorBody.replaceChildren(table); }

function autoResizeTA(ta){ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight, window.innerHeight*0.6)+'px'; }
function syncMatrixIntoWorkbook(){ const ws=XLSX.utils.aoa_to_sheet(currentMatrix); currentWB.Sheets[currentSheetName]=ws; if(!currentWB.SheetNames.includes(currentSheetName)) currentWB.SheetNames.push(currentSheetName); }
function addRow(){ const cols=Math.max(1, headerRow(currentMatrix).length); currentMatrix.push(new Array(cols).fill('')); renderMatrix(currentMatrix); }
function saveBackToIndexedDB(){ if(!currentFileRec) return; const extension=ext(currentFileRec.name); let blob, mime; if(extension==='csv' || currentFileRec.type==='text/csv'){ const csv=matrixToCSV(currentMatrix); blob = new Blob([csv],{type:'text/csv'}); mime='text/csv'; } else { syncMatrixIntoWorkbook(); const ab = XLSX.write(currentWB,{bookType:'xlsx', type:'array'}); blob = new Blob([ab],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; } getFile(currentFileRec.id).then(rec=>{ rec.blob=blob; rec.type=mime; rec.size=blob.size; putFile(rec).then(()=>{ currentFileRec=rec; els.editorMeta.textContent = `${rec.type} • ${humanSize(rec.size)}`; refreshFiles(); alert('Saved.'); }).catch(e=>alert('Save failed: '+e.message)); }); }

// ------------------------------
// Exact Viewer (embeds from URLs only in this build)
// ------------------------------
function hostKind(url){ if(/docs.google.com\/spreadsheets/.test(url)) return 'Google Sheets'; if(/onedrive\.live\.com|office\.com|sharepoint\.com/.test(url)) return 'OneDrive Excel'; return 'Other'; }
function toEmbedUrl(raw){ let url=(raw||'').trim(); if(!url) return ''; try{ const u=new URL(url); if(u.hostname.includes('docs.google.com') && u.pathname.includes('/spreadsheets/')){ const id = u.pathname.split('/d/')[1]?.split('/')[0]; const gid = (u.searchParams.get('gid')||'0'); return `https://docs.google.com/spreadsheets/d/${id}/pubhtml?widget=true&headers=false&gid=${gid}`; } if(u.hostname.includes('onedrive.live.com')){ const resid = u.searchParams.get('resid'); const auth = u.searchParams.get('authkey'); if(resid){ const params = new URLSearchParams(); params.set('resid', resid); if(auth) params.set('authkey', auth); params.set('em','2'); params.set('wdAllowInteractivity','True'); params.set('wdHideHeaders','True'); return `https://onedrive.live.com/embed?${params.toString()}`; } } if(u.hostname.includes('office.com') || u.hostname.includes('sharepoint.com')) return url; return url; }catch{ return url; } }

function openExactView(url, title){ const embed = toEmbedUrl(url); els.exactWarn.textContent = (!url? 'No URL set for Exact View.' : 'If the sheet does not load: ensure it is either published to the web (Google Sheets) or shared for anyone-with-link and allows embedding.'); els.exactTitle.textContent = `Exact Viewer — ${title||''}`; els.exactFrame.src = embed || 'about:blank'; els.openInNewTabBtn.onclick = ()=>{ if(embed) window.open(embed,'_blank'); }; openModal(els.exactModal,false); }

// ------------------------------
// Import/Export + Download self
// ------------------------------
async function exportAll(){ const games = await listGames(); const filesByGame = {}; const linksByGame = {}; for(const g of games){ const files = await listFiles(g.id); filesByGame[g.id] = await Promise.all(files.map(rec=> new Promise((res)=>{ const fr=new FileReader(); fr.onload = ()=>res({ id:rec.id, name:rec.name, type:rec.type, size:rec.size, addedAt:rec.addedAt, exactUrl:rec.exactUrl||'', dataUrl:fr.result }); fr.readAsDataURL(rec.blob); }))); const links = await listLinks(g.id); linksByGame[g.id] = links; } const payload = { meta:{ app:'GameSheets', version:'3.0-split', exportedAt:Date.now() }, games, filesByGame, linksByGame }; const blob = new Blob([JSON.stringify(payload)], {type:'application/json'}); downloadBlob(`gamesheets-backup-${new Date().toISOString().slice(0,10)}.json`, blob); }
async function importAll(file){ const text = await file.text(); const data = JSON.parse(text); if(!data || !data.games) throw new Error('Invalid backup'); await new Promise((res,rej)=>{ const t=db.transaction(['games','files','links'],'readwrite'); t.objectStore('games').clear(); t.objectStore('files').clear(); t.objectStore('links').clear(); t.oncomplete=res; t.onerror=()=>rej(t.error); }); for(const g of data.games){ await new Promise((res,rej)=>{ const r=tx('games','readwrite').add({ id:g.id, name:g.name }); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); } if(data.filesByGame){ for(const [gid, arr] of Object.entries(data.filesByGame)){ for(const f of arr){ const blob = dataURLtoBlob(f.dataUrl); await new Promise((res,rej)=>{ const r=tx('files','readwrite').add({ id:f.id, gameId:Number(gid), name:f.name, type:f.type, size:f.size, addedAt:f.addedAt, exactUrl:f.exactUrl||'', blob }); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); } } } if(data.linksByGame){ for(const [gid, arr] of Object.entries(data.linksByGame)){ for(const l of arr){ await new Promise((res,rej)=>{ const r=tx('links','readwrite').add(l); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); } } } await refreshGames(); if(currentGameId){ await refreshFiles(); await refreshLinks(); } alert('Import complete.'); }
function dataURLtoBlob(dataUrl){ const parts = String(dataUrl).split(','); const head = parts[0] || ''; const body = parts[1] || ''; const mimeMatch = head.match(/:(.*?);/); const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'; const bin = atob(body); const len = bin.length; const arr = new Uint8Array(len); for(let i=0;i<len;i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], {type:mime}); }
function downloadSelf(){ const doctype='<!DOCTYPE html>\n'; const html=document.documentElement.outerHTML; const blob=new Blob([doctype+html],{type:'text/html'}); downloadBlob('game-sheets.html', blob); }

// ------------------------------
// Modal helpers
// ------------------------------
function openModal(modal, lockScroll){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); if(lockScroll) document.documentElement.style.overflow='hidden'; }
function closeModal(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); document.documentElement.style.overflow=''; if(modal===els.editorModal){ els.editorBody.replaceChildren(); els.sheetTabs.replaceChildren(); currentWB=null; currentMatrix=null; currentFileRec=null; currentSheetName=null; } if(modal===els.exactModal){ els.exactFrame.src='about:blank'; } }

// ------------------------------
// Init + event wiring
// ------------------------------
async function init(){
  mapEls();
  try{ db = await openDB(); }catch(err){ alert('IndexedDB is blocked or unsupported. Local files will not be saved.'); }
  await refreshGames();
  setGameEnabled(false);

  // Add game
  els.addGameBtn.addEventListener('click', async ()=>{
    const name = els.newGameName.value;
    if(!name || !name.trim()) return;
    const id = await addGame(name.trim());
    els.newGameName.value='';
    await refreshGames();
    await selectGame(id);
  });
  els.newGameName.addEventListener('keydown', e=>{ if(e.key==='Enter') els.addGameBtn.click(); });

  // Upload local files
  els.uploadBtn.addEventListener('click', ()=>{ if(!currentGameId) return; els.fileInput.click(); });
  els.fileInput.addEventListener('change', async ()=>{
    if(!currentGameId || !els.fileInput.files?.length) return;
    await addFiles(currentGameId, els.fileInput.files);
    els.fileInput.value='';
    await refreshFiles();
    await refreshGames();
  });

  // Game actions
  els.renameGameBtn.addEventListener('click', async ()=>{
    if(!currentGameId) return;
    const g = await getGame(currentGameId);
    const name = prompt('Rename game:', g?.name || '');
    if(!name) return;
    await renameGame(currentGameId, name);
    await refreshGames();
    selectGame(currentGameId);
  });
  els.deleteGameBtn.addEventListener('click', async ()=>{
    if(!currentGameId) return;
    const g = await getGame(currentGameId);
    if(confirm(`Delete "${g?.name||'this game'}" and all its files/links? This cannot be undone.`)){
      await deleteGame(currentGameId);
      currentGameId = null;
      showNoGame();
    }
  });

  // Filters
  els.search.addEventListener('input', refreshFiles);

  // Online links
  els.addLinkBtn.addEventListener('click', async ()=>{
    if(!currentGameId) return;
    const name = (els.newLinkName.value||'').trim();
    const url  = (els.newLinkUrl.value||'').trim();
    if(!name || !url) return;
    await addLink(currentGameId, name, url);
    els.newLinkName.value='';
    els.newLinkUrl.value='';
    await refreshLinks();
  });

  // Export / Import / Download
  els.exportBtn.addEventListener('click', exportAll);
  els.importBtn.addEventListener('click', ()=> els.importFile.click());
  els.importFile.addEventListener('change', async ()=>{
    const f = els.importFile.files?.[0];
    if(!f) return;
    try{ await importAll(f); }catch(e){ alert('Import failed: '+ e.message); } finally { els.importFile.value=''; }
  });
  els.downloadHtmlBtn.addEventListener('click', downloadSelf);

  // Editor modal wiring
  els.closeEditor.addEventListener('click', ()=> closeModal(els.editorModal));
  document.getElementById('editorModal').addEventListener('click', (e)=>{ if(e.target.id==='editorModal') closeModal(els.editorModal); });
  els.addRowBtn.addEventListener('click', addRow);
  els.saveBtn.addEventListener('click', ()=>{ try{ saveBackToIndexedDB(); }catch(e){ alert('Save failed: '+e.message); } });
  els.exportCsvBtn.addEventListener('click', ()=>{ const csv=matrixToCSV(currentMatrix||[]); downloadBlob(`${(currentFileRec?.name||'sheet').replace(/\.[^.]+$/, '')}.csv`, new Blob([csv],{type:'text/csv'})); });
  els.exportXlsxBtn.addEventListener('click', ()=>{ syncMatrixIntoWorkbook(); const ab=XLSX.write(currentWB,{bookType:'xlsx',type:'array'}); downloadBlob(`${(currentFileRec?.name||'workbook').replace(/\.[^.]+$/, '')}.xlsx`, new Blob([ab],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); });

  // Exact viewer modal wiring
  els.closeExact.addEventListener('click', ()=> closeModal(els.exactModal));
  document.getElementById('exactModal').addEventListener('click', (e)=>{ if(e.target.id==='exactModal') closeModal(els.exactModal); });

  console.log('[GameSheets] init complete');
}

document.addEventListener('DOMContentLoaded', init);
