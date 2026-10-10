const zlib = require('zlib');
const path = require('path');

function unzip(buf) {
  const files = new Map();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const entities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
const xml = (files, name) => (files.has(name) ? files.get(name)().toString('utf8') : '');

function docx(buf) {
  const body = xml(unzip(buf), 'word/document.xml');
  return entities(
    body
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pptx(buf) {
  const files = unzip(buf);
  const slides = [...files.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  return slides
    .map(
      (n, i) =>
        `# Slide ${i + 1}\n` +
        [...xml(files, n).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => entities(m[1])).join('\n'),
    )
    .join('\n\n');
}

function xlsx(buf) {
  const files = unzip(buf);
  const shared = [...xml(files, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    entities([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('')),
  );
  const sheets = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  const col = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return sheets
    .map((n, i) => {
      const rows = [...xml(files, n).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 400).map((r) => {
        const cells = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = (c[1].match(/r="([A-Z]+\d+)"/) || [])[1];
          const v = c[2]
            ? (c[2].match(/<v>([^<]*)<\/v>/) || c[2].match(/<t[^>]*>([^<]*)<\/t>/) || [])[1]
            : '';
          cells[ref ? col(ref) : cells.length] = /t="s"/.test(c[1])
            ? shared[Number(v)] || ''
            : entities(v || '');
        }
        return Array.from(cells, (x) => x || '').join('\t');
      });
      return `# Sheet ${i + 1}\n` + rows.join('\n');
    })
    .join('\n\n');
}

async function pdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let text = '';
    for (const it of content.items) text += it.str + (it.hasEOL ? '\n' : '');
    pages.push(text.trim());
  }
  await doc.destroy();
  return pages.filter(Boolean).join('\n\n') || '(this PDF has no text layer: it is probably a scan)';
}

const KINDS = { '.pdf': pdf, '.docx': docx, '.xlsx': xlsx, '.pptx': pptx };
const isDocument = (name) => path.extname(String(name)).toLowerCase() in KINDS;

async function extract(name, buf) {
  const fn = KINDS[path.extname(String(name)).toLowerCase()];
  if (!fn) return buf.includes(0) ? '(binary file, cannot be read as text)' : buf.toString('utf8');
  try {
    return await fn(buf);
  } catch (e) {
    return `(could not read this ${path.extname(name).slice(1).toUpperCase()} file: ${e.message})`;
  }
}

module.exports = { extract, isDocument, unzip };
