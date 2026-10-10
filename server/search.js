const fs = require('fs');
const path = require('path');
const { SKIP_DIRS } = require('./tools');

const CHUNK = 40;
const OVERLAP = 8;
const cache = new Map();
const TEXT_EXT =
  /\.(js|jsx|ts|tsx|mjs|cjs|py|java|kt|kts|go|rs|c|h|cpp|hpp|cs|rb|php|swift|dart|lua|sh|ps1|sql|html?|css|scss|vue|svelte|json|ya?ml|toml|ini|md|txt|xml|gradle)$/i;

function tokens(text) {
  const out = [];
  for (const word of String(text).split(/[^\p{L}\p{N}_]+/u)) {
    if (!word) continue;
    for (const part of word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_]+/)) {
      const t = part.toLowerCase();
      if (t.length >= 2 && t.length < 40) out.push(t);
    }
  }
  return out;
}

function scan(root) {
  const idx = cache.get(root) || { files: new Map() };
  cache.set(root, idx);
  const seen = new Set();
  let budget = 3000;
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (budget <= 0) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 8 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(full, depth + 1);
        continue;
      }
      if (!TEXT_EXT.test(e.name)) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size > 300000) continue;
      budget--;
      const rel = path.relative(root, full).split(path.sep).join('/');
      seen.add(rel);
      const old = idx.files.get(rel);
      if (old && old.mtime === st.mtimeMs) continue;
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      const chunks = [];
      for (let i = 0; i < lines.length; i += CHUNK - OVERLAP) {
        const body = lines.slice(i, i + CHUNK).join('\n');
        if (!body.trim()) continue;
        const tf = new Map();
        const tk = tokens(rel + ' ' + body);
        for (const t of tk) tf.set(t, (tf.get(t) || 0) + 1);
        chunks.push({ start: i + 1, end: Math.min(lines.length, i + CHUNK), body, tf, len: tk.length });
        if (i + CHUNK >= lines.length) break;
      }
      idx.files.set(rel, { mtime: st.mtimeMs, chunks });
    }
  };
  walk(root, 0);
  for (const rel of [...idx.files.keys()]) if (!seen.has(rel)) idx.files.delete(rel);
  return idx;
}

function bm25(idx, query, limit) {
  const all = [];
  for (const [rel, f] of idx.files) for (const c of f.chunks) all.push({ rel, ...c });
  if (!all.length) return [];
  const avg = all.reduce((n, c) => n + c.len, 0) / all.length;
  const terms = [...new Set(tokens(query))];
  const df = new Map(terms.map((t) => [t, all.filter((c) => c.tf.has(t)).length]));
  for (const c of all) {
    let s = 0;
    for (const t of terms) {
      const f = c.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (all.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * c.len) / avg));
    }
    c.score = s;
  }
  return all
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const cosine = (a, b) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
};

async function find(root, query, embed) {
  const idx = scan(root);
  let hits = bm25(idx, query, embed ? 24 : 6);
  let how = 'by words';
  if (embed && hits.length > 1) {
    try {
      const vectors = await embed([query, ...hits.map((h) => h.rel + '\n' + h.body.slice(0, 1500))]);
      if (vectors && vectors.length === hits.length + 1) {
        const top = hits[0].score || 1;
        hits.forEach((h, i) => (h.score = 0.4 * (h.score / top) + 0.6 * cosine(vectors[0], vectors[i + 1])));
        hits.sort((a, b) => b.score - a.score);
        how = 'by meaning';
      }
    } catch {}
    hits = hits.slice(0, 6);
  }
  if (!hits.length)
    return `Nothing in the project matches "${query}". Try other words, or list_dir to look around.`;
  return (
    `Best matches (${how}):\n` +
    hits
      .map((h) => `--- ${h.rel} lines ${h.start}-${h.end}\n${h.body.split('\n').slice(0, 14).join('\n')}`)
      .join('\n') +
    '\nUse read_file with "line" to see more of a file.'
  );
}

module.exports = { find, tokens, scan };
