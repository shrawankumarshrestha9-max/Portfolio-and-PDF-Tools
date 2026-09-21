/* ==========================================================
   file-converters.js — turns different file types into
   plain text lines and/or images that can be placed in a PDF.
   ========================================================== */
(function () {
  'use strict';

  const PdfTools = window.PdfTools;

  /* ---------- What kind of file is this? ---------- */

  PdfTools.categorizeFile = function (file) {
    const name = file.name.toLowerCase();
    const type = file.type;

    if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(name)) {
      return { category: 'image', label: 'Image' };
    }
    if (type.includes('pdf') || name.endsWith('.pdf')) {
      return { category: 'pdf', label: 'PDF' };
    }
    if (
      name.endsWith('.xlsx') || name.endsWith('.xlsm') || name.endsWith('.xlsb') ||
      name.endsWith('.xls') || name.endsWith('.ods') ||
      type.includes('spreadsheet') || type.includes('excel')
    ) {
      return { category: 'spreadsheet', label: 'Spreadsheet' };
    }
    if (name.endsWith('.docx') || name.endsWith('.docm')) {
      return { category: 'docx', label: 'Word' };
    }
    if (name.endsWith('.pptx') || name.endsWith('.pptm')) {
      return { category: 'pptx', label: 'PowerPoint' };
    }
    if (type.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) {
      return { category: 'html', label: 'HTML' };
    }
    if (
      type.startsWith('text/') ||
      /\.(txt|md|csv|json|xml|log|rtf|tsv|yaml|yml|ini|conf|bat|sh|sql|css|js|ts|py|java|c|cpp|go|rs|rb|php)$/i.test(name)
    ) {
      return { category: 'text', label: 'Text' };
    }
    return { category: 'unknown', label: 'File' };
  };

  /* ---------- File readers ---------- */

  function readFile(file, method) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader[method](file);
    });
  }

  const readAsText = (file) => readFile(file, 'readAsText');
  const readAsDataURL = (file) => readFile(file, 'readAsDataURL');
  const readAsArrayBuffer = (file) => readFile(file, 'readAsArrayBuffer');

  const IMAGE_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
  };

  /* ---------- Main entry point ----------
     Returns { textLines: string[], images?: string[] (data URLs) } */

  PdfTools.extractFileContent = async function (file, category) {
    switch (category) {
      case 'text':
        return { textLines: (await readAsText(file)).split('\n') };

      case 'html':
        return { textLines: htmlToText(await readAsText(file)).split('\n') };

      case 'image':
        return { textLines: [], images: [await readAsDataURL(file)] };

      case 'spreadsheet':
        return convertSpreadsheet(file);

      case 'docx':
        return convertDocx(file);

      case 'pptx':
        return convertPptx(file);

      case 'pdf':
        return { textLines: ['[PDF file — use the Merge tab to combine PDFs]'] };

      default:
        return { textLines: ['[Unsupported file type]'] };
    }
  };

  /* ---------- HTML ---------- */

  function htmlToText(html) {
    // DOMParser builds an inert document: nothing in the file can run or load
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style, script').forEach(function (el) { el.remove(); });
    return (doc.body.textContent || '').trim();
  }

  /* ---------- Spreadsheets ---------- */

  async function convertSpreadsheet(file) {
    const XLSX = await PdfTools.loadLib('xlsx');
    const workbook = XLSX.read(await readAsArrayBuffer(file), { type: 'array' });
    const lines = [];

    workbook.SheetNames.forEach(function (sheetName) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
      if (lines.length > 0) lines.push('');
      lines.push('=== Sheet: ' + sheetName + ' ===');
      rows.forEach(function (row) {
        lines.push((row || []).map(function (cell) { return String(cell == null ? '' : cell); }).join('  |  '));
      });
    });

    return { textLines: lines };
  }

  /* ---------- Word / PowerPoint (both are zip files full of XML) ---------- */

  // Pulls readable text out of an XML string, one line per paragraph
  function xmlToLines(xml, paragraphPattern) {
    return xml
      .replace(paragraphPattern, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  // Collects the pictures stored inside the zip as data URLs
  async function extractMedia(zip, folder) {
    const images = [];
    const paths = Object.keys(zip.files).filter(function (path) { return path.startsWith(folder); });

    for (const path of paths) {
      const entry = zip.file(path);
      if (!entry) continue;
      const ext = path.split('.').pop().toLowerCase();
      const blob = await entry.async('blob');
      // give the blob a proper type so the browser can read it as an image
      const typed = new Blob([blob], { type: IMAGE_TYPES[ext] || 'application/octet-stream' });
      images.push(await readAsDataURL(typed));
    }
    return images;
  }

  async function convertDocx(file) {
    const JSZip = await PdfTools.loadLib('jszip');
    const zip = await JSZip.loadAsync(await readAsArrayBuffer(file));
    const lines = [];

    const documentXml = zip.file('word/document.xml');
    if (documentXml) {
      const xml = await documentXml.async('string');
      if (/<w:p[ >]/.test(xml)) {
        lines.push('=== ' + file.name + ' ===', '');
      }
      lines.push.apply(lines, xmlToLines(xml, /<w:p[^>]*>/g));
    }

    const images = await extractMedia(zip, 'word/media/');
    return { textLines: lines.length > 0 ? lines : ['[Could not extract text]'], images: images };
  }

  async function convertPptx(file) {
    const JSZip = await PdfTools.loadLib('jszip');
    const zip = await JSZip.loadAsync(await readAsArrayBuffer(file));
    const lines = ['=== ' + file.name + ' ===', ''];

    const slideNumber = (path) => parseInt((path.match(/slide(\d+)\.xml/) || [])[1] || '0', 10);
    const slidePaths = Object.keys(zip.files)
      .filter(function (path) { return /^ppt\/slides\/slide\d+\.xml$/.test(path); })
      .sort(function (a, b) { return slideNumber(a) - slideNumber(b); });

    for (const path of slidePaths) {
      const slideFile = zip.file(path);
      if (!slideFile) continue;
      const xml = await slideFile.async('string');
      lines.push('--- Slide ' + slideNumber(path) + ' ---');
      lines.push.apply(lines, xmlToLines(xml, /<a:p[^>]*>/g));
      lines.push('');
    }

    const images = await extractMedia(zip, 'ppt/media/');
    return { textLines: lines.length > 2 ? lines : ['[Could not extract text]'], images: images };
  }

  /* ---------- Images ----------
     jsPDF only accepts JPEG and PNG. Anything else (GIF, WebP, SVG, BMP…)
     is redrawn on a canvas first. Returns null if the browser can't read it. */

  function loadImage(src) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  PdfTools.prepareImage = async function (dataUrl) {
    const img = await loadImage(dataUrl);
    if (!img) return null;

    const width = img.naturalWidth || img.width || 400;
    const height = img.naturalHeight || img.height || 300;

    if (/^data:image\/png/i.test(dataUrl)) return { dataUrl: dataUrl, format: 'PNG', width: width, height: height };
    if (/^data:image\/jpe?g/i.test(dataUrl)) return { dataUrl: dataUrl, format: 'JPEG', width: width, height: height };

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG', width: width, height: height };
  };
})();
