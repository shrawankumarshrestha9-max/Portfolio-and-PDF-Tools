/* ==========================================================
   pdf-merge.js — the "Merge PDFs" tab.
   Add PDFs -> drag (or use the arrows) to reorder -> merge.
   ========================================================== */
(function () {
  'use strict';

  const { formatBytes, makeId, loadLib, downloadBlob, setupDropzone, renderList } = window.PdfTools;

  /* ---------- Page elements ---------- */
  const zone = document.getElementById('merge-dropzone');
  const input = document.getElementById('merge-input');
  const stats = document.getElementById('merge-stats');
  const statFiles = document.getElementById('merge-stat-files');
  const statReady = document.getElementById('merge-stat-ready');
  const statPages = document.getElementById('merge-stat-pages');
  const section = document.getElementById('merge-files');
  const list = document.getElementById('merge-list');
  const countEl = document.getElementById('merge-count');
  const clearBtn = document.getElementById('merge-clear');
  const runBtn = document.getElementById('merge-run');
  const hint = document.getElementById('merge-hint');
  const hintText = document.getElementById('merge-hint-text');
  const rowTemplate = document.getElementById('merge-row-template');

  const HINT_DEFAULT = hintText.textContent.trim();

  /* ---------- State ----------
     item = { id, file, pageCount, status }
     status: 'working' (reading the PDF) | 'done' (ready to merge) | 'error' */
  let items = [];
  let draggedId = null;
  let merging = false;
  const rows = new Map();

  /* ---------- Drawing the list ---------- */

  function createRow(item) {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = item.id;
    row.querySelector('.file-row__remove').addEventListener('click', function () {
      removeItem(item.id);
    });
    row.querySelectorAll('[data-move]').forEach(function (btn) {
      btn.addEventListener('click', function () { moveItem(item.id, btn.dataset.move === 'up' ? -1 : 1); });
    });
    return row;
  }

  function updateRow(row, item, index) {
    row.dataset.status = item.status;
    row.classList.toggle('is-dragging', draggedId === item.id);

    row.querySelector('.order-badge__num').textContent = index + 1;
    const name = row.querySelector('.file-row__name');
    name.textContent = item.file.name;
    name.title = item.file.name;
    row.querySelector('.file-row__meta').textContent =
      formatBytes(item.file.size) + (item.pageCount !== undefined ? ' · ' + item.pageCount + (item.pageCount === 1 ? ' page' : ' pages') : '');

    row.querySelector('[data-move="up"]').disabled = index === 0;
    row.querySelector('[data-move="down"]').disabled = index === items.length - 1;
  }

  function render() {
    const ready = items.filter(function (i) { return i.status === 'done'; });
    const totalPages = ready.reduce(function (sum, i) { return sum + (i.pageCount || 0); }, 0);

    stats.hidden = items.length === 0;
    statFiles.textContent = items.length;
    statReady.textContent = ready.length;
    statPages.textContent = totalPages;

    section.hidden = items.length === 0;
    countEl.textContent = items.length;
    clearBtn.disabled = merging;

    runBtn.hidden = ready.length < 2;
    runBtn.disabled = merging;
    runBtn.querySelectorAll('.js-ready-count').forEach(function (el) { el.textContent = ready.length; });

    if (!merging) {
      hintText.textContent = HINT_DEFAULT;
      hint.hidden = ready.length !== 1;
    }

    renderList(list, items, rows, createRow, updateRow);
  }

  /* ---------- Adding / removing / re-ordering ---------- */

  async function readPageCount(file) {
    const { PDFDocument } = await loadLib('pdflib');
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    return pdf.getPageCount();
  }

  async function addFiles(files) {
    const pdfs = files.filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); });
    const added = pdfs.map(function (file) {
      return { id: makeId(file.name), file: file, status: 'working' };
    });
    items = items.concat(added);
    render();

    for (const item of added) {
      try {
        item.pageCount = await readPageCount(item.file);
        item.status = 'done';
      } catch (err) {
        item.status = 'error';
      }
      render();
    }
  }

  function removeItem(id) {
    items = items.filter(function (i) { return i.id !== id; });
    render();
  }

  function moveItem(id, step) {
    const from = items.findIndex(function (i) { return i.id === id; });
    const to = from + step;
    if (from === -1 || to < 0 || to >= items.length) return;
    const moved = items.splice(from, 1)[0];
    items.splice(to, 0, moved);
    render();
  }

  clearBtn.addEventListener('click', function () {
    items = [];
    render();
  });

  setupDropzone(zone, input, addFiles);

  /* ---------- Drag rows to re-order ---------- */

  list.addEventListener('dragstart', function (e) {
    const row = e.target.closest('.file-row');
    if (!row) return;
    draggedId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);   // Firefox needs some data to start a drag
    requestAnimationFrame(render);                     // fade the dragged row
  });

  list.addEventListener('dragover', function (e) {
    if (!draggedId) return;
    e.preventDefault();
    const row = e.target.closest('.file-row');
    if (!row || row.dataset.id === draggedId) return;

    const from = items.findIndex(function (i) { return i.id === draggedId; });
    const to = items.findIndex(function (i) { return i.id === row.dataset.id; });
    if (from === -1 || to === -1) return;
    items.splice(to, 0, items.splice(from, 1)[0]);
    render();
  });

  list.addEventListener('dragend', function () {
    draggedId = null;
    render();
  });

  /* ---------- Merging ---------- */

  function showMessage(text) {
    hintText.textContent = text;
    hint.hidden = false;
  }

  async function mergePdfs() {
    const ready = items.filter(function (i) { return i.status === 'done'; });
    if (ready.length < 2 || merging) return;

    merging = true;
    let failed = false;
    runBtn.dataset.state = 'busy';
    render();

    try {
      const { PDFDocument } = await loadLib('pdflib');
      const merged = await PDFDocument.create();

      for (const item of ready) {
        const source = await PDFDocument.load(await item.file.arrayBuffer());
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach(function (page) { merged.addPage(page); });
      }

      merged.setTitle('Merged PDF');
      merged.setCreator('Shrawan Portfolio PDF Tools');
      merged.setProducer('Shrawan Portfolio PDF Tools');

      const bytes = await merged.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'merged-' + Date.now() + '.pdf');

      runBtn.dataset.state = 'done';
      setTimeout(function () { runBtn.dataset.state = 'idle'; }, 3000);
    } catch (err) {
      failed = true;
      runBtn.dataset.state = 'idle';
    } finally {
      merging = false;
      render();
    }

    if (failed) {
      showMessage('Sorry, these PDFs could not be merged. One of them may be damaged or password-protected.');
    }
  }

  runBtn.addEventListener('click', mergePdfs);
})();
