/* ==========================================================
   file-to-pdf.js — the "File to PDF" tab.
   Add files -> choose settings -> one combined PDF downloads.
   ========================================================== */
(function () {
  'use strict';

  const { formatBytes, makeId, loadLib, downloadBlob, setIcon, setupDropzone, renderList } = window.PdfTools;
  const { categorizeFile, extractFileContent, prepareImage } = window.PdfTools;

  /* ---------- Page elements ---------- */
  const zone = document.getElementById('convert-dropzone');
  const input = document.getElementById('convert-input');
  const section = document.getElementById('convert-files');
  const list = document.getElementById('convert-list');
  const countEl = document.getElementById('convert-count');
  const doneEl = document.getElementById('convert-done');
  const clearBtn = document.getElementById('convert-clear');
  const runBtn = document.getElementById('convert-run');
  const runLabel = document.getElementById('convert-run-label');
  const rowTemplate = document.getElementById('convert-row-template');

  /* ---------- State ----------
     item = { id, file, category, label, status, preview }
     status: 'pending' | 'working' | 'done' | 'error' */
  let items = [];
  let converting = false;
  const rows = new Map();

  const CATEGORY_ICONS = {
    image: 'image', spreadsheet: 'table', docx: 'file-text', pptx: 'presentation',
    html: 'globe', pdf: 'file', text: 'file-text', unknown: 'file',
  };

  /* ---------- Drawing the list ---------- */

  function createRow(item) {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('.file-row__remove').addEventListener('click', function () {
      removeItem(item.id);
    });
    return row;
  }

  function updateRow(row, item) {
    row.dataset.status = item.status;

    const name = row.querySelector('.file-row__name');
    name.textContent = item.file.name;
    name.title = item.file.name;
    row.querySelector('.file-row__meta').textContent = item.label + ' · ' + formatBytes(item.file.size);

    const img = row.querySelector('.file-row__img');
    const icon = row.querySelector('.file-row__icon');
    // show the picture itself for images, otherwise an icon for the file type
    // (toggleAttribute, because SVG elements have no .hidden property)
    img.toggleAttribute('hidden', !item.preview);
    icon.toggleAttribute('hidden', !!item.preview);
    if (item.preview) {
      if (img.getAttribute('src') !== item.preview) img.src = item.preview;
    } else {
      setIcon(icon, CATEGORY_ICONS[item.category] || 'file');
    }
  }

  function render() {
    const pending = items.filter(function (i) { return i.status === 'pending'; }).length;
    const done = items.filter(function (i) { return i.status === 'done'; }).length;

    section.hidden = items.length === 0;
    countEl.textContent = items.length;
    doneEl.hidden = done === 0;
    doneEl.textContent = '· ' + done + ' converted';
    clearBtn.disabled = converting;

    runBtn.hidden = pending === 0 && !converting;
    runBtn.disabled = converting;
    runBtn.setAttribute('aria-busy', converting ? 'true' : 'false');
    runLabel.textContent = 'Convert ' + pending + ' File' + (pending === 1 ? '' : 's') + ' to PDF';

    renderList(list, items, rows, createRow, updateRow);
  }

  /* ---------- Adding / removing files ---------- */

  function addFiles(files) {
    files.forEach(function (file) {
      const info = categorizeFile(file);
      items.push({
        id: makeId(file.name),
        file: file,
        category: info.category,
        label: info.label,
        status: 'pending',
        preview: info.category === 'image' ? URL.createObjectURL(file) : null,
      });
    });
    render();
  }

  function releasePreview(item) {
    if (item.preview) URL.revokeObjectURL(item.preview);
  }

  function removeItem(id) {
    items.filter(function (i) { return i.id === id; }).forEach(releasePreview);
    items = items.filter(function (i) { return i.id !== id; });
    render();
  }

  clearBtn.addEventListener('click', function () {
    items.forEach(releasePreview);
    items = [];
    render();
  });

  setupDropzone(zone, input, addFiles);

  /* ---------- Building the PDF ---------- */

  function readSettings() {
    return {
      pageSize: document.querySelector('input[name="pageSize"]:checked').value,
      orientation: document.querySelector('input[name="orientation"]:checked').value,
      metadata: document.getElementById('opt-metadata').checked,
    };
  }

  // Writes one file (text first, then pictures) into the open PDF document
  async function addFileToPdf(item, doc, isFirst) {
    const fontSize = 11;
    const lineHeight = 1.5;
    const margin = 50;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;

    if (!isFirst) doc.addPage();
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');

    if (item.category === 'pdf') {
      doc.text('PDF files cannot be converted to PDF pages. Use the Merge tab to combine PDFs.', margin, margin);
      return;
    }

    const result = await extractFileContent(item.file, item.category);
    let y = margin;

    // text
    for (const line of result.textLines || []) {
      const wrapped = doc.splitTextToSize(line || ' ', maxWidth);
      for (const piece of wrapped) {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(piece, margin, y);
        y += fontSize * lineHeight;
      }
    }

    // pictures
    for (const dataUrl of result.images || []) {
      const image = await prepareImage(dataUrl);
      if (!image) continue;                       // unreadable picture: skip it

      const fit = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height, 1);
      const w = image.width * fit;
      const h = image.height * fit;

      if (y + h > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      try {
        doc.addImage(image.dataUrl, image.format, (pageWidth - w) / 2, y, w, h);
        y += h + 15;
      } catch (err) {
        // skip pictures the PDF library cannot embed
      }
    }
  }

  async function convertAll() {
    if (converting) return;
    const pending = items.filter(function (i) { return i.status === 'pending'; });
    if (pending.length === 0) return;

    converting = true;
    pending.forEach(function (i) { i.status = 'working'; });
    render();

    try {
      const { jsPDF } = await loadLib('jspdf');
      const options = readSettings();
      const doc = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.pageSize });

      if (options.metadata) {
        doc.setProperties({
          title: 'Converted Documents',
          subject: 'AI PDF Converter',
          author: 'Shrawan Shrestha',
          creator: 'Shrawan Portfolio PDF Tools',
        });
      }

      let succeeded = 0;
      for (let n = 0; n < pending.length; n++) {
        try {
          await addFileToPdf(pending[n], doc, n === 0);
          pending[n].status = 'done';
          succeeded++;
        } catch (err) {
          pending[n].status = 'error';
        }
        render();
      }

      if (succeeded > 0) downloadBlob(doc.output('blob'), 'converted-' + Date.now() + '.pdf');
    } catch (err) {
      pending.forEach(function (i) { if (i.status === 'working') i.status = 'error'; });
    } finally {
      converting = false;
      render();
    }
  }

  runBtn.addEventListener('click', convertAll);
})();
