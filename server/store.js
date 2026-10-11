const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOME = process.env.EMBER_HOME || path.join(os.homedir(), '.ember');
const SESSIONS = path.join(HOME, 'sessions');
const USER_SKILLS = path.join(HOME, 'skills');
const BUILTIN_SKILLS = path.join(__dirname, '..', 'skills');
const PROJECTS = process.env.EMBER_PROJECTS || path.join(os.homedir(), 'EmberProjects');
for (const d of [HOME, SESSIONS, USER_SKILLS]) fs.mkdirSync(d, { recursive: true });

const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://127.0.0.1:11434',
  openaiEnabled: false,
  openaiUrl: 'http://127.0.0.1:1234/v1',
  openaiKey: '',
  defaultModel: 'auto',
  defaultMode: 'acceptEdits',
  defaultEffort: 'medium',
  numCtx: 0,
  disabledSkills: [],
  hardwareOverride: { enabled: false, ramGB: 16, vramGB: 8 },
  theme: 'dark',
  lang: 'en',
  onboarded: false,
  starters: true,
  userName: '',
  userAddress: '',
  purpose: '',
  fontScale: 'm',
  sendKey: 'enter',
  notify: false,
  keepAlive: 10,
  projectsDir: '',
  gpu: { mode: 'auto', off: [], order: [], spread: null, reserveGB: 0 },
  perf: { flash: false, kv: false, oneModel: false, single: false },
  memory: true,
  runTests: true,
  autoPreview: true,
  remote: { enabled: false, url: '', key: '' },
  share: { enabled: false, port: 11500, key: '' },
  webAccess: true,
  mcpServers: [],
  modelTests: {},
  modelNames: {},
};

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
};

let settings = { ...DEFAULT_SETTINGS, ...readJson(path.join(HOME, 'settings.json'), {}) };
if (settings.defaultEffort === 'off') settings.defaultEffort = 'low';
const getSettings = () => settings;
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  writeJson(path.join(HOME, 'settings.json'), settings);
  return settings;
}

const cache = new Map();
const sessionFile = (id) => path.join(SESSIONS, id.replace(/[^\w-]/g, '') + '.json');

function newSession(patch = {}) {
  const id = crypto.randomUUID();
  const s = {
    id,
    title: '',
    created: Date.now(),
    updated: Date.now(),
    cwd: '',
    model: settings.defaultModel,
    mode: settings.defaultMode,
    effort: settings.defaultEffort,
    items: [],
    ctx: [],
    plan: [],
    planStep: 0,
    changed: {},
    snapshots: {},
    ...patch,
  };
  cache.set(id, s);
  return s;
}

function getSession(id) {
  if (cache.has(id)) return cache.get(id);
  const s = readJson(sessionFile(id), null);
  if (s) cache.set(id, s);
  return s;
}

function saveSession(s) {
  s.updated = Date.now();
  writeJson(sessionFile(s.id), s);
}

function deleteSession(id) {
  cache.delete(id);
  fs.rmSync(sessionFile(id), { force: true });
}

function listSessions(q) {
  const query = String(q || '')
    .trim()
    .toLowerCase();
  const out = [];
  for (const f of fs.readdirSync(SESSIONS)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const s = cache.get(id) || readJson(path.join(SESSIONS, f), null);
    if (!s || !s.items || !s.items.length || s.hidden) continue;
    if (
      query &&
      !(s.title || '').toLowerCase().includes(query) &&
      !s.items.some(
        (it) =>
          (it.type === 'user' || it.type === 'assistant') && String(it.text).toLowerCase().includes(query),
      )
    )
      continue;
    out.push({ id: s.id, title: s.title, updated: s.updated, cwd: s.cwd, pinned: !!s.pinned });
  }
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
}

function ensureCwd(s) {
  if (s.cwd && fs.existsSync(s.cwd)) return s.cwd;
  const stamp = new Date().toISOString().slice(0, 10);
  const base = settings.projectsDir || PROJECTS;
  let dir = path.join(base, `project-${stamp}`);
  for (let n = 2; fs.existsSync(dir) && fs.readdirSync(dir).length; n++)
    dir = path.join(base, `project-${stamp}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  s.cwd = dir;
  return dir;
}

const MEMORY = path.join(HOME, 'memory.md');
const getMemory = () => {
  try {
    return fs.readFileSync(MEMORY, 'utf8');
  } catch {
    return '';
  }
};
const setMemory = (text) => fs.writeFileSync(MEMORY, String(text).slice(0, 6000));
function addMemory(fact) {
  const line = String(fact).replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!line) return false;
  const lines = getMemory()
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean);
  if (lines.some((l) => l.toLowerCase() === line.toLowerCase())) return false;
  lines.push(line);
  setMemory(
    lines
      .slice(-60)
      .map((l) => '- ' + l)
      .join('\n') + '\n',
  );
  return true;
}

function parseSkill(file, builtin) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  if (m)
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  const name = meta.name || path.basename(path.dirname(file));
  return {
    name,
    title: meta.title || name,
    description: meta.description || '',
    body: (m ? m[2] : raw).trim(),
    builtin,
  };
}

function listSkills() {
  const out = new Map();
  for (const [dir, builtin] of [
    [BUILTIN_SKILLS, true],
    [USER_SKILLS, false],
  ]) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const file = path.join(dir, d, 'SKILL.md');
      if (fs.existsSync(file)) {
        const sk = parseSkill(file, builtin);
        out.set(sk.name, sk);
      }
    }
  }
  return [...out.values()].map((sk) => ({ ...sk, enabled: !settings.disabledSkills.includes(sk.name) }));
}

function saveSkill({ name, title, description, body }) {
  const slug = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Skill name: latin letters, digits and dashes.');
  const dir = path.join(USER_SKILLS, slug);
  fs.mkdirSync(dir, { recursive: true });
  const oneLine = (v) =>
    String(v || '')
      .replace(/\r?\n/g, ' ')
      .trim();
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${slug}\ntitle: ${oneLine(title) || slug}\ndescription: ${oneLine(description)}\n---\n${String(body || '').trim()}\n`,
  );
  return slug;
}

function deleteSkill(name) {
  const dir = path.join(USER_SKILLS, String(name).replace(/[^a-z0-9-]/g, ''));
  if (dir !== USER_SKILLS && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

module.exports = {
  getMemory,
  setMemory,
  addMemory,
  HOME,
  PROJECTS,
  getSettings,
  saveSettings,
  newSession,
  getSession,
  saveSession,
  deleteSession,
  listSessions,
  ensureCwd,
  listSkills,
  saveSkill,
  deleteSkill,
};
