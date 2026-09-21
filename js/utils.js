/* ==========================================================
   utils.js — small helpers shared by both PDF tools.
   Plain browser JavaScript (no build step, no modules).
   Everything is attached to one global: window.PdfTools
   ========================================================== */
(function () {
  'use strict';

  const PdfTools = (window.PdfTools = window.PdfTools || {});

  /* ---------- Formatting ---------- */

  PdfTools.formatBytes = function (bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  PdfTools.makeId = function (name) {
    return name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  };

  /* ---------- Third-party libraries (loaded only when needed) ----------
     The big libraries live in js/vendor/. Each one is fetched the first
     time a tool actually needs it, so the page itself stays light. */

  const LIBS = {
    jspdf:  { src: 'js/vendor/jspdf.umd.min.js', get: () => window.jspdf },    // create PDFs
    pdflib: { src: 'js/vendor/pdf-lib.min.js',   get: () => window.PDFLib },   // merge PDFs
    xlsx:   { src: 'js/vendor/xlsx.full.min.js', get: () => window.XLSX },     // read spreadsheets
    jszip:  { src: 'js/vendor/jszip.min.js',     get: () => window.JSZip },     // read DOCX / PPTX
  };
  const loading = {};

  PdfTools.loadLib = function (name) {
    const lib = LIBS[name];
    if (!lib) return Promise.reject(new Error('Unknown library: ' + name));
    if (lib.get()) return Promise.resolve(lib.get());

    if (!loading[name]) {
      loading[name] = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = lib.src;
        script.onload = function () { resolve(lib.get()); };
        script.onerror = function () {
          delete loading[name];
          reject(new Error('Could not load ' + lib.src));
        };
        document.head.appendChild(script);
      });
    }
    return loading[name];
  };

  /* ---------- Downloads ---------- */

  PdfTools.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  };

  /* ---------- Icons (point an <svg><use> at another sprite symbol) ---------- */

  PdfTools.setIcon = function (svg, iconName) {
    svg.querySelector('use').setAttribute('href', '#icon-' + iconName);
  };

  /* ---------- Drop zones ----------
     Clicking works with no script at all (the zone is a <label> for the file input).
     This adds drag & drop and hands every chosen file to onFiles(arrayOfFiles). */

  function dragHasFiles(event) {
    return !!event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') !== -1;
  }

  PdfTools.setupDropzone = function (zone, input, onFiles) {
    zone.addEventListener('dragover', function (e) {
      if (!dragHasFiles(e)) return;            // ignore rows being re-ordered
      e.preventDefault();
      zone.classList.add('is-dragging');
    });
    zone.addEventListener('dragleave', function (e) {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-dragging');
    });
    zone.addEventListener('drop', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      zone.classList.remove('is-dragging');
      if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
    });
    input.addEventListener('change', function () {
      const files = Array.from(input.files);
      input.value = '';                        // lets you pick the same file again
      if (files.length) onFiles(files);
    });
  };

  // A file dropped outside a drop zone would make the browser open it and lose your list.
  ['dragover', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (dragHasFiles(e)) e.preventDefault();
    });
  });

  /* ---------- Lists ----------
     Keeps a <ul> in sync with an array without rebuilding every row,
     so animations and image previews are not restarted on each change. */

  PdfTools.renderList = function (listEl, items, rows, createRow, updateRow) {
    const keep = new Set(items.map(function (item) { return item.id; }));

    rows.forEach(function (row, id) {
      if (!keep.has(id)) {
        row.remove();
        rows.delete(id);
      }
    });

    items.forEach(function (item, index) {
      let row = rows.get(item.id);
      if (!row) {
        row = createRow(item);
        rows.set(item.id, row);
      }
      updateRow(row, item, index);
      if (listEl.children[index] !== row) {
        listEl.insertBefore(row, listEl.children[index] || null);
      }
    });
  };
})();
