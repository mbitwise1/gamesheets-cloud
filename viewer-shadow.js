// viewer-shadow.js — fully isolated offline viewer using Shadow DOM
// Include AFTER your existing app.js. REMOVE viewer-patch.css/js to avoid conflicts.
// <script src="app.js"></script>
// <script src="viewer-shadow.js"></script>
//
// This overrides renderMatrix() and renders the grid inside a Shadow DOM
// attached to '#editorModal .table-wrap'. Styles cannot leak out and cannot
// be affected by your global CSS.

(function(){
  if (!window.XLSX) { console.warn('[viewer-shadow] XLSX not found.'); return; }
  if (typeof window.renderMatrix !== 'function') { console.warn('[viewer-shadow] renderMatrix() not found to override.'); }

  const CSS = `
:host { all: initial; contain: content; font-family: Inter, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #e5e7eb; }
.wrap { all: revert; }
.table { table-layout: fixed; width: 100%; background: #0b142a; border-collapse: separate; border-spacing: 0; }
.table th, .table td { border: 1px solid rgba(255,255,255,.12); vertical-align: top; padding: 0; }
.thead th { position: sticky; top: 0; background: #0e1a36; z-index: 3; padding: 8px 10px; text-align: left; }
.sticky-col { position: sticky; left: 0; z-index: 2; background: #0e1a36; }
tbody .sticky-col { background: #0b142a; z-index: 1; }
.cell-textarea { min-height: 6.5em; max-height: 60vh; resize: vertical; overflow: auto; padding: 10px 12px; background: transparent; color: #e5e7eb; border: 0; line-height: 1.4; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.cell-checkbox { display:flex; align-items:center; justify-content:center; padding:8px; }
tbody tr.zebra { background: rgba(255,255,255,.03); }
.cell:focus-within { outline: 2px solid rgba(34,197,94,.6); outline-offset: -2px; }
  `.trim();

  // ---------- helpers ----------
  function headerRow(matrix){ return matrix.length ? matrix[0] : []; }
  function autoResizeTA(ta){
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.6) + 'px';
  }
  function isBooleanLike(v){
    if (typeof v === 'boolean') return true;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'false' || s === 'yes' || s === 'no' ||
           s === 'y' || s === 'n' || s === '1' || s === '0' || s === '☑' || s === '☐';
  }
  function normalizeBool(v){
    const s = String(v).trim().toLowerCase();
    return (s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === '☑');
  }
  function clamp(n,a,b){ return Math.min(Math.max(n,a),b); }

  function getMerges(){
    try {
      const ws = window.currentWB?.Sheets?.[window.currentSheetName];
      return (ws && ws['!merges']) ? ws['!merges'] : [];
    } catch { return []; }
  }
  function computeMergeMaps(merges){
    const topLeft = new Map();
    const hidden = new Set();
    for (const m of merges) {
      const r0=m.s.r, c0=m.s.c, r1=m.e.r, c1=m.e.c;
      const rowSpan=(r1-r0)+1, colSpan=(c1-c0)+1;
      topLeft.set(`${r0},${c0}`, { rowSpan, colSpan });
      for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++){
        if (r===r0 && c===c0) continue;
        hidden.add(`${r},${c}`);
      }
    }
    return { topLeft, hidden };
  }

  function computeColWidths(matrix){
    const rows = matrix || [];
    const cols = Math.max(...rows.map(r => r.length), 1);
    try {
      const ws = window.currentWB?.Sheets?.[window.currentSheetName];
      const sheetCols = ws && ws['!cols'];
      if (Array.isArray(sheetCols) && sheetCols.length) {
        const widths = new Array(cols).fill(12);
        for (let c=0;c<cols;c++){
          const colObj = sheetCols[c] || {};
          if (colObj.wch) widths[c] = clamp(colObj.wch, 8, 48);
          else if (colObj.wpx) widths[c] = clamp(colObj.wpx/8, 8, 48);
          else widths[c] = 12;
        }
        return widths;
      }
    } catch {}
    const widths = new Array(cols).fill(0);
    const maxRowsToSample = Math.min(rows.length, 400);
    for (let c=0;c<cols;c++){
      let maxLen=0;
      for (let r=0;r<maxRowsToSample;r++){
        const txt = String(rows[r]?.[c] ?? '');
        const wide = (txt.match(/[MW@#%&]/g) || []).length * 0.7;
        const digits = (txt.match(/[0-9]/g) || []).length * 0.15;
        const est = txt.length + wide + digits;
        if (est > maxLen) maxLen = est;
        if (maxLen > 90) break;
      }
      widths[c] = clamp(Math.ceil(maxLen*0.95+2), 10, 48);
    }
    return widths;
  }

  function rememberScroll(container){
    if (!container) return {x:0,y:0,apply:()=>{}};
    const x = container.scrollLeft, y = container.scrollTop;
    return { x, y, apply(){ container.scrollTo({left:x, top:y, behavior:'instant'}); } };
  }

  function bindKeyboardNav(tbody){
    tbody.addEventListener('keydown', (e)=>{
      const target = e.target;
      if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;

      const cell = target.closest('td.cell');
      if (!cell) return;

      const row = cell.parentElement;
      const rowIdx = Array.from(row.parentElement.children).indexOf(row);
      const colIdx = Array.from(row.children).indexOf(cell);

      const focusCell = (r, c)=>{
        const tr = tbody.children[r];
        if (!tr) return;
        let td = tr.children[c];
        if (!td) return;
        const input = td.querySelector('textarea, input, select');
        if (input) { input.focus(); input.select?.(); }
      };

      if (e.key === 'Enter' && !(target instanceof HTMLTextAreaElement) && !e.shiftKey) {
        e.preventDefault(); focusCell(rowIdx + 1, colIdx);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); focusCell(rowIdx + 1, colIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); focusCell(Math.max(0, rowIdx - 1), colIdx);
      } else if (e.key === 'ArrowRight' && !(target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); focusCell(rowIdx, colIdx + 1);
      } else if (e.key === 'ArrowLeft' && !(target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); focusCell(rowIdx, Math.max(0, colIdx - 1));
      }
    });
  }

  // ---------- Shadow root plumbing ----------
  function getShadowHost(){
    const modal = document.getElementById('editorModal');
    if (!modal) return null;
    const wrap = modal.querySelector('.table-wrap') || modal.querySelector('#editorBody');
    if (!wrap) return null;

    let host = wrap.querySelector('.shadow-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'shadow-host';
      host.style.all = 'initial';
      host.style.display = 'block';
      host.style.width = '100%';
      host.style.height = '100%';
      wrap.replaceChildren(host);
    }
    return host;
  }

  function ensureShadow(){
    const host = getShadowHost();
    if (!host) return {};
    let root = host.shadowRoot;
    if (!root) {
      root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);

      const container = document.createElement('div');
      container.className = 'wrap';
      container.style.all = 'revert';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.overflow = 'auto';
      root.appendChild(container);
    }
    const container = root.querySelector('.wrap');
    return { root, container };
  }

  // ---------- Override renderMatrix to render inside Shadow DOM ----------
  const originalRender = window.renderMatrix;
  window.renderMatrix = function(matrix){
    const { container } = ensureShadow();
    if (!container) { console.warn('[viewer-shadow] no container'); return originalRender(matrix); }

    const restore = rememberScroll(container);

    // Build table
    const merges = getMerges();
    const { topLeft, hidden } = (function(merges){
      const tl = new Map(), hid = new Set();
      for (const m of (merges||[])) {
        const r0=m.s.r, c0=m.s.c, r1=m.e.r, c1=m.e.c;
        const rowSpan=(r1-r0)+1, colSpan=(c1-c0)+1;
        tl.set(`${r0},${c0}`, { rowSpan, colSpan });
        for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++){
          if (r===r0 && c===c0) continue;
          hid.add(`${r},${c}`);
        }
      }
      return { topLeft: tl, hidden: hid };
    })(merges);

    const table = document.createElement('table');
    table.className = 'table';

    const widths = computeColWidths(matrix);
    const colgroup = document.createElement('colgroup');
    widths.forEach((w, idx)=>{
      const col = document.createElement('col');
      col.style.width = w + 'ch';
      if (idx === 0) col.className = 'sticky-col-width';
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement('thead');
    thead.className = 'thead';
    const trh = document.createElement('tr');
    const cols = Math.max(...matrix.map(r => r.length), 1);
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th');
      th.textContent = headerRow(matrix)[c] ?? '';
      if (c === 0) th.classList.add('sticky-col');
      trh.appendChild(th);
    }
    thead.appendChild(trh);

    const tbody = document.createElement('tbody');
    const startRow = 1;
    for (let r = startRow; r < matrix.length; r++) {
      const tr = document.createElement('tr');
      if (r % 2 === 1) tr.classList.add('zebra');
      for (let c = 0; c < cols; c++) {
        if (hidden.has(`${r},${c}`)) continue;
        const td = document.createElement('td');
        td.className = 'cell';
        const span = topLeft.get(`${r},${c}`);
        if (span) {
          if (span.rowSpan > 1) td.rowSpan = span.rowSpan;
          if (span.colSpan > 1) td.colSpan = span.colSpan;
        }
        if (c === 0) td.classList.add('sticky-col');

        const v = matrix[r]?.[c] ?? '';
        const useSmart = window.els?.smartControls?.checked ?? true;
        if (useSmart && isBooleanLike(v)) {
          const wrap = document.createElement('div');
          wrap.className = 'cell-checkbox';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = normalizeBool(v);
          cb.addEventListener('change', ()=>{ matrix[r][c] = cb.checked ? 'TRUE' : 'FALSE'; });
          wrap.appendChild(cb);
          td.appendChild(wrap);
        } else {
          const ta = document.createElement('textarea');
          ta.className = 'cell-textarea';
          const str = String(v == null ? '' : v);
          ta.value = str;
          ta.rows = Math.max(5, Math.ceil((str.split('\n').length + str.length/60)));
          autoResizeTA(ta);
          ta.addEventListener('input', ()=>{ autoResizeTA(ta); matrix[r][c] = ta.value; });
          td.appendChild(ta);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    container.replaceChildren(table);

    bindKeyboardNav(tbody);
    restore.apply();
  };

  console.log('[viewer-shadow] Shadow DOM offline viewer loaded.');
})();
