// viewer-patch.js — drop-in enhancements for the OFFLINE spreadsheet viewer
// Include AFTER your existing app.js so we can override renderMatrix() safely.
//
// Enhancements:
// - Sticky header row and first column
// - Multi-line cell editing (5-line comfort height)
// - Autosize columns: respects ws['!cols'] when present; otherwise measure text
// - Honors merged cells via ws['!merges']
// - Zebra striping
// - Basic keyboard navigation within the grid (Arrow keys / Tab / Enter)
// - Preserves scroll position across re-renders

(function(){
  if (!window.XLSX) { console.warn('[viewer-patch] XLSX not found.'); return; }
  if (typeof window.renderMatrix !== 'function') { console.warn('[viewer-patch] renderMatrix() not found to override.'); }

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

  // Get merges from current sheet if available
  function getMerges(){
    try {
      const ws = window.currentWB?.Sheets?.[window.currentSheetName];
      return (ws && ws['!merges']) ? ws['!merges'] : [];
    } catch { return []; }
  }

  // Use XLSX-provided column widths if present (ws['!cols']), otherwise estimate from text
  function computeColWidths(matrix){
    const rows = matrix || [];
    const cols = Math.max(...rows.map(r => r.length), 1);

    // Prefer workbook widths
    try {
      const ws = window.currentWB?.Sheets?.[window.currentSheetName];
      const sheetCols = ws && ws['!cols'];
      if (Array.isArray(sheetCols) && sheetCols.length) {
        const widths = new Array(cols).fill(12);
        for (let c = 0; c < cols; c++) {
          const colObj = sheetCols[c] || {};
          // SheetJS width fields: wpx (pixels) or wch (characters)
          if (colObj.wch) widths[c] = clamp(colObj.wch, 8, 48);
          else if (colObj.wpx) widths[c] = clamp(colObj.wpx / 8, 8, 48); // rough px->ch
          else widths[c] = 12;
        }
        return widths;
      }
    } catch {}

    // Fallback: estimate from data
    const widths = new Array(cols).fill(0);
    const maxRowsToSample = Math.min(rows.length, 400);
    for (let c = 0; c < cols; c++) {
      let maxLen = 0;
      for (let r = 0; r < maxRowsToSample; r++) {
        const val = rows[r]?.[c];
        const txt = (val == null ? '' : String(val));
        // count wide glyphs a bit more
        const wide = (txt.match(/[MW@#%&]/g) || []).length * 0.7;
        const digits = (txt.match(/[0-9]/g) || []).length * 0.15;
        const est = txt.length + wide + digits;
        if (est > maxLen) maxLen = est;
        if (maxLen > 90) break;
      }
      widths[c] = clamp(Math.ceil(maxLen * 0.95 + 2), 10, 48);
    }
    return widths;
  }
  function clamp(n, a, b){ return Math.min(Math.max(n, a), b); }

  // Build merge maps: which cell starts a merge, and which are hidden
  function computeMergeMaps(merges){
    const topLeft = new Map(); // "r,c" -> {rowSpan, colSpan}
    const hidden = new Set();  // "r,c" for covered cells (not the top-left)
    for (const m of merges) {
      const r0 = m.s.r, c0 = m.s.c, r1 = m.e.r, c1 = m.e.c;
      const rowSpan = (r1 - r0) + 1;
      const colSpan = (c1 - c0) + 1;
      topLeft.set(`${r0},${c0}`, { rowSpan, colSpan });
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (r === r0 && c === c0) continue;
          hidden.add(`${r},${c}`);
        }
      }
    }
    return { topLeft, hidden };
  }

  // Keyboard navigation
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
        e.preventDefault();
        focusCell(rowIdx + 1, colIdx);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusCell(rowIdx + 1, colIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusCell(Math.max(0, rowIdx - 1), colIdx);
      } else if (e.key === 'ArrowRight' && !(target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        focusCell(rowIdx, colIdx + 1);
      } else if (e.key === 'ArrowLeft' && !(target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        focusCell(rowIdx, Math.max(0, colIdx - 1));
      }
    });
  }

  // Preserve scroll position of .table-wrap across re-renders
  function rememberScroll(){
    const wrap = window.els?.editorBody?.querySelector('.table-wrap') || window.els?.editorBody;
    if (!wrap) return {x:0,y:0, apply:()=>{}};
    const x = wrap.scrollLeft, y = wrap.scrollTop;
    return { x, y, apply(){ wrap.scrollTo({ left: x, top: y, behavior: 'instant' }); } };
  }

  // ---------- OVERRIDE ----------
  const originalRender = window.renderMatrix;
  window.renderMatrix = function(matrix){
    const restore = rememberScroll();

    const merges = getMerges();
    const { topLeft, hidden } = computeMergeMaps(merges || []);

    const table = document.createElement('table');
    table.className = 'table table-enhanced';

    // column widths
    const widths = computeColWidths(matrix);
    const colgroup = document.createElement('colgroup');
    widths.forEach((w, idx) => {
      const col = document.createElement('col');
      col.style.width = w + 'ch';
      if (idx === 0) col.className = 'sticky-col-width';
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    // THEAD (sticky)
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

    // TBODY (with sticky first col, merges, comfy cells)
    const tbody = document.createElement('tbody');
    const startRow = 1; // skip header row
    for (let r = startRow; r < matrix.length; r++) {
      const tr = document.createElement('tr');
      if (r % 2 === 1) tr.classList.add('zebra');

      for (let c = 0; c < cols; c++) {
        if (hidden.has(`${r},${c}`)) continue; // covered by merge

        const td = document.createElement('td');
        td.className = 'cell';
        // apply merge spans if top-left of a merge range
        const span = topLeft.get(`${r},${c}`);
        if (span) {
          if (span.rowSpan > 1) td.rowSpan = span.rowSpan;
          if (span.colSpan > 1) td.colSpan = span.colSpan;
        }

        // sticky first column
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
          const str = String(v == null ? '' : v);
          const ta = document.createElement('textarea');
          ta.className = 'cell-textarea comfy';
          ta.value = str;
          ta.rows = Math.max(5, Math.ceil((str.split('\n').length + str.length / 60)));
          autoResizeTA(ta);
          ta.addEventListener('input', ()=>{
            autoResizeTA(ta);
            matrix[r][c] = ta.value;
          });
          td.appendChild(ta);
        }

        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);

    // Inject table into existing wrap (same container your app uses)
    const wrap = window.els?.editorBody?.querySelector('.table-wrap');
    if (wrap) {
      wrap.replaceChildren(table);
    } else {
      window.els.editorBody.replaceChildren(table);
    }

    // keyboard nav + restore scroll
    bindKeyboardNav(tbody);
    restore.apply();
  };

  console.log('[viewer-patch] Enhanced offline viewer loaded.');
})();
