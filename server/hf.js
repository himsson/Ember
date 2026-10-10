const hardware = require('./hardware');

const API = 'https://huggingface.co/api/models';
const GB = 1024 ** 3;

async function get(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'ember-app' }, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new Error('Hugging Face is not responding. Check your internet connection.');
  }
  if (!res.ok) throw new Error('Hugging Face error: ' + res.status);
  return res.json();
}

async function search(query, sort) {
  const params = new URLSearchParams({
    filter: 'gguf',
    sort: sort === 'likes' ? 'likes' : sort === 'new' ? 'lastModified' : 'downloads',
    direction: '-1',
    limit: '48',
  });
  if (query) params.set('search', query);
  const list = await get(`${API}?${params}`);
  const notChat =
    /speech|audio|text-to-image|image-to-image|text-to-video|feature-extraction|sentence-similarity|object-detection|image-segmentation/;
  return list
    .filter((m) => !notChat.test(m.pipeline_tag || '') && !/\.cpp$|embed|whisper|tts/i.test(m.id))
    .map((m) => {
      const [author, repo] = m.id.split('/');
      const tags = m.tags || [];
      return {
        id: m.id,
        name: (repo || m.id).replace(/[-_.]?gguf$/i, ''),
        author,
        downloads: m.downloads || 0,
        likes: m.likes || 0,
        vision: /image-text|vision/.test(m.pipeline_tag || '') || tags.includes('vision'),
        uncensored: /uncensored|abliterat|heretic/i.test(m.id),
        code: /coder|code/i.test(m.id),
      };
    });
}

async function versions(id, hw) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(id)) throw new Error('Invalid model name');
  const tree = await get(`${API}/${id}/tree/main`);
  const out = [];
  for (const f of tree) {
    if (f.type !== 'file' || !/\.gguf$/i.test(f.path) || /mmproj|-\d{5}-of-\d{5}/i.test(f.path)) continue;
    const m = f.path.match(/((?:UD-)?(?:I?Q\d\w*|BF16|F16|F32))\.gguf$/i);
    if (!m) continue;
    const sizeGB = Math.round(((f.lfs ? f.lfs.size : f.size) / GB) * 10) / 10;
    out.push({
      quant: m[1].toUpperCase(),
      tag: `hf.co/${id}:${m[1]}`,
      sizeGB,
      rate: hardware.rate(sizeGB, hw),
    });
  }
  out.sort((a, b) => a.sizeGB - b.sizeGB);
  const good = out.filter((v) => v.rate.level === 'fast' || v.rate.level === 'ok');
  const pool = good.length ? good : out.filter((v) => v.rate.level !== 'no');
  const pick =
    pool.find((v) => v.quant === 'Q4_K_M') ||
    pool.filter((v) => /^Q[45]/.test(v.quant)).pop() ||
    pool[pool.length - 1];
  if (pick) pick.best = true;
  return out;
}

module.exports = { search, versions };
