const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const web = require('./web');
const docs = require('./docs');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.ember-trash',
  '__pycache__',
  'build',
  'dist',
  '.gradle',
  '.idea',
  'venv',
  '.venv',
]);
const MAX_READ_LINES = 200;
const MAX_RESULT_CHARS = 6000;

const TOOLS = [
  { name: 'list_dir', kind: 'read', fields: ['path'], required: [], help: 'show files and folders' },
  {
    name: 'read_file',
    kind: 'read',
    fields: ['path', 'line'],
    required: ['path'],
    help: `read a file (${MAX_READ_LINES} lines starting at "line", default 1)`,
  },
  {
    name: 'find_code',
    kind: 'read',
    fields: ['query'],
    required: ['query'],
    help: 'find where something is in a big project: describe it in words, get the best matching places',
  },
  {
    name: 'search_text',
    kind: 'read',
    fields: ['pattern', 'path'],
    required: ['pattern'],
    help: 'find text in project files',
  },
  {
    name: 'check_tool',
    kind: 'read',
    fields: ['name'],
    required: ['name'],
    help: 'check that a program is installed (node, python, git, java, android-studio...)',
  },
  {
    name: 'write_file',
    kind: 'edit',
    fields: ['path'],
    required: ['path'],
    help: 'create or fully overwrite a file; you write its content in your next reply',
  },
  {
    name: 'append_file',
    kind: 'edit',
    fields: ['path'],
    required: ['path'],
    help: 'add text to the end of a file; you write the text in your next reply',
  },
  {
    name: 'edit_file',
    kind: 'edit',
    fields: ['path', 'instruction', 'find', 'replace'],
    required: ['path'],
    help: 'change a file: say what to change in "instruction" (for long files give exact "find" and "replace" text instead)',
  },
  { name: 'make_dir', kind: 'edit', fields: ['path'], required: ['path'], help: 'create a folder' },
  {
    name: 'delete_file',
    kind: 'edit',
    fields: ['path'],
    required: ['path'],
    help: 'delete a file or folder (moved to the project trash)',
  },
  {
    name: 'run_command',
    kind: 'exec',
    fields: ['command'],
    required: ['command'],
    help: 'run a shell command in the project folder',
  },
  { name: 'web_search', kind: 'net', fields: ['query'], required: ['query'], help: 'search the internet' },
  { name: 'web_fetch', kind: 'net', fields: ['url'], required: ['url'], help: 'read a web page as text' },
  {
    name: 'use_tool',
    kind: 'meta',
    fields: ['name'],
    required: ['name'],
    help: 'call an external tool from the list below; you give its arguments in your next reply',
  },
  {
    name: 'remember',
    kind: 'meta',
    fields: ['text'],
    required: ['text'],
    help: 'save one lasting fact about the user or their preferences for future chats',
  },
  {
    name: 'use_skill',
    kind: 'meta',
    fields: ['name'],
    required: ['name'],
    help: 'load the instructions of a skill',
  },
  {
    name: 'ask_user',
    kind: 'meta',
    fields: ['question', 'options'],
    required: ['question'],
    help: 'ask the user and wait; "options" are short answer buttons',
  },
  {
    name: 'finish',
    kind: 'meta',
    fields: ['text'],
    required: ['text'],
    help: 'end the turn; "text" is your message to the user',
  },
];
const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

const KNOWN_PROGRAMS = {
  node: { bins: ['node'], winget: 'OpenJS.NodeJS.LTS', title: 'Node.js' },
  npm: { bins: ['npm'], winget: 'OpenJS.NodeJS.LTS', title: 'Node.js (npm)' },
  python: { bins: ['python', 'python3', 'py'], winget: 'Python.Python.3.12', title: 'Python' },
  pip: { bins: ['pip', 'pip3'], winget: 'Python.Python.3.12', title: 'Python (pip)' },
  git: { bins: ['git'], winget: 'Git.Git', title: 'Git' },
  java: { bins: ['java'], winget: 'EclipseAdoptium.Temurin.17.JDK', title: 'Java JDK 17' },
  gradle: { bins: ['gradle'], winget: 'Gradle.Gradle', title: 'Gradle' },
  'android-studio': {
    bins: ['studio64', 'studio'],
    paths: [
      'C:\\Program Files\\Android\\Android Studio',
      '/Applications/Android Studio.app',
      '/opt/android-studio',
    ],
    env: ['ANDROID_HOME', 'ANDROID_SDK_ROOT'],
    winget: 'Google.AndroidStudio',
    title: 'Android Studio',
  },
  dotnet: { bins: ['dotnet'], winget: 'Microsoft.DotNet.SDK.8', title: '.NET SDK' },
  go: { bins: ['go'], winget: 'GoLang.Go', title: 'Go' },
  rust: { bins: ['cargo', 'rustc'], winget: 'Rustlang.Rustup', title: 'Rust' },
  flutter: { bins: ['flutter'], winget: null, title: 'Flutter' },
  docker: { bins: ['docker'], winget: 'Docker.DockerDesktop', title: 'Docker Desktop' },
  ffmpeg: { bins: ['ffmpeg'], winget: 'Gyan.FFmpeg', title: 'FFmpeg' },
};

const DANGEROUS = [
  /\brm\s+(-\w*\s+)*-\w*[rf]/i,
  /\bdel\s+\/[sq]/i,
  /\brd\s+\/s/i,
  /\brmdir\s+\/s/i,
  /remove-item\b.*-recurse/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bmkfs/i,
  /\bshutdown\b/i,
  /\breg\s+(delete|add)/i,
  /\bdd\s+if=/i,
  /\|\s*(sh|bash|iex|powershell)\b/i,
  /invoke-expression/i,
  /\bgit\s+(push|reset\s+--hard|clean)/i,
  /\bsudo\b/i,
  /\btaskkill\b/i,
];
const INSTALLS = [
  /\bwinget\s+install/i,
  /\bchoco\s+install/i,
  /\bnpm\s+(i|install)\s+(-g|--global)/i,
  /\bpip3?\s+install/i,
  /\bapt(-get)?\s+install/i,
  /\bbrew\s+install/i,
  /\bscoop\s+install/i,
  /\bcurl\b|\bwget\b|invoke-webrequest/i,
];

function commandRisk(command) {
  if (DANGEROUS.some((r) => r.test(command))) return 'dangerous';
  if (INSTALLS.some((r) => r.test(command))) return 'install';
  return 'normal';
}

function resolveSafe(root, p) {
  const rel = String(p == null || p === '' ? '.' : p).replace(/^["']|["']$/g, '');
  const full = path.resolve(root, rel);
  const back = path.relative(root, full);
  if (back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`Path "${rel}" is outside the project folder. Use paths relative to the project folder.`);
  }
  return full;
}

const relOf = (root, full) => path.relative(root, full).split(path.sep).join('/') || '.';

function clip(text, max = MAX_RESULT_CHARS) {
  text = String(text);
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  return (
    text.slice(0, head) +
    `\n...[${text.length - max} chars cut]...\n` +
    text.slice(text.length - (max - head))
  );
}

// Models wrap content in fences or send "\n" as two characters.
function cleanContent(content) {
  let c = String(content);
  const fence = c.match(/^\s*```[\w+-]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (fence) c = fence[1];
  if (!c.includes('\n') && (c.match(/\\n/g) || []).length >= 2) {
    c = c
      .replace(/\\r\\n|\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"');
  }
  return c;
}

function whichBin(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function checkSyntax(full) {
  const ext = path.extname(full).toLowerCase();
  try {
    if (ext === '.json') {
      JSON.parse(fs.readFileSync(full, 'utf8'));
      return 'Syntax check: OK (valid JSON).';
    }
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      const r = spawnSync(process.execPath, ['--check', full], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      return r.status === 0 ? 'Syntax check: OK.' : 'Syntax check FAILED, fix it:\n' + clip(r.stderr, 800);
    }
    if (ext === '.py') {
      const py = whichBin('python') || whichBin('python3');
      if (!py) return '';
      const r = spawnSync(
        py,
        ['-c', 'import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8").read())', full],
        { encoding: 'utf8', windowsHide: true },
      );
      return r.status === 0 ? 'Syntax check: OK.' : 'Syntax check FAILED, fix it:\n' + clip(r.stderr, 800);
    }
    if (['.html', '.htm'].includes(ext)) {
      const t = fs.readFileSync(full, 'utf8');
      const bad = ['script', 'style'].filter(
        (tag) =>
          (t.match(new RegExp('<' + tag + '[\\s>]', 'gi')) || []).length !==
          (t.match(new RegExp('</' + tag + '>', 'gi')) || []).length,
      );
      return bad.length ? `Check FAILED: unclosed <${bad.join('>, <')}> tag.` : '';
    }
  } catch (e) {
    return 'Syntax check FAILED, fix it:\n' + clip(e.message, 800);
  }
  return '';
}

function lineStats(before, after) {
  const count = (arr) => arr.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = count(before ? before.split('\n') : []);
  const b = count(after ? after.split('\n') : []);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) || 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) || 0));
  return { added, removed };
}

function applyEdit(text, find, replace) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const src = text.replace(/\r\n/g, '\n');
  find = cleanContent(find).replace(/\r\n/g, '\n');
  replace = cleanContent(replace).replace(/\r\n/g, '\n');
  if (!find.trim()) return { error: '"find" is empty. Put the exact text to replace in "find".' };

  const exact = src.split(find).length - 1;
  if (exact === 1) return { text: src.replace(find, () => replace).replace(/\n/g, eol) };
  if (exact > 1)
    return { error: `"find" occurs ${exact} times. Add more surrounding lines to "find" so it is unique.` };

  const lines = src.split('\n');
  const want = find.split('\n').map((l) => l.trim());
  while (want.length && !want[0]) want.shift();
  while (want.length && !want[want.length - 1]) want.pop();
  const hits = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (want.every((w, j) => lines[i + j].trim() === w)) hits.push(i);
  }
  if (hits.length === 1) {
    const i = hits[0];
    const fileIndent = lines[i].match(/^\s*/)[0];
    const repLines = replace.split('\n');
    const repIndent = (repLines.find((l) => l.trim()) || '').match(/^\s*/)[0];
    const fixed = repLines.map((l) =>
      l.trim() ? fileIndent + (l.startsWith(repIndent) ? l.slice(repIndent.length) : l.trimStart()) : l,
    );
    lines.splice(i, want.length, ...fixed);
    return { text: lines.join(eol), fuzzy: true };
  }
  if (hits.length > 1)
    return {
      error: `"find" matches ${hits.length} places. Add more surrounding lines to "find" so it is unique.`,
    };

  let best = -1;
  const first = want[0] || '';
  for (let i = 0; i < lines.length && best < 0; i++) if (first && lines[i].trim() === first) best = i;
  for (let i = 0; i < lines.length && best < 0; i++)
    if (first.length > 8 && lines[i].includes(first.slice(0, Math.min(24, first.length)))) best = i;
  const near =
    best >= 0
      ? '\nThe file really contains this near your "find":\n' +
        lines.slice(Math.max(0, best - 2), best + 8).join('\n')
      : '';
  return {
    error:
      'The text in "find" was not found in the file. Copy it exactly from read_file, or rewrite the whole file with write_file.' +
      near,
  };
}

async function listDir(root, dir) {
  const out = [];
  async function walk(d, depth) {
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= 120) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        out.push(relOf(root, full) + '/');
        if (depth < 2 && !SKIP_DIRS.has(e.name)) await walk(full, depth + 1);
      } else {
        const st = await fsp.stat(full).catch(() => null);
        out.push(`${relOf(root, full)} (${st ? st.size : 0} bytes)`);
      }
    }
  }
  await walk(dir, 0);
  if (!out.length) return 'The folder is empty.';
  return out.join('\n') + (out.length >= 120 ? '\n...[more entries not shown]' : '');
}

async function searchText(root, dir, pattern) {
  const needle = String(pattern).toLowerCase();
  const hits = [];
  async function walk(d) {
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (hits.length >= 30) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(full);
        continue;
      }
      const st = await fsp.stat(full).catch(() => null);
      if (!st || st.size > 400000) continue;
      const text = await fsp.readFile(full, 'utf8').catch(() => '');
      if (text.includes('\u0000')) continue;
      text.split(/\r?\n/).forEach((l, i) => {
        if (hits.length < 30 && l.toLowerCase().includes(needle))
          hits.push(`${relOf(root, full)}:${i + 1}: ${l.trim().slice(0, 160)}`);
      });
    }
  }
  await walk(dir);
  return hits.length ? hits.join('\n') : `No matches for "${pattern}".`;
}

function checkTool(name) {
  const key = String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/\.exe$/, '');
  const known = KNOWN_PROGRAMS[key] || KNOWN_PROGRAMS[key.replace(/^android$/, 'android-studio')];
  const bins = known ? known.bins : [key];
  for (const b of bins) {
    const found = whichBin(b);
    if (found) return { installed: true, text: `${known ? known.title : name} is installed: ${found}` };
  }
  if (known) {
    for (const p of known.paths || [])
      if (fs.existsSync(p)) return { installed: true, text: `${known.title} is installed: ${p}` };
    for (const e of known.env || [])
      if (process.env[e] && fs.existsSync(process.env[e]))
        return { installed: true, text: `${known.title} SDK found: ${process.env[e]}` };
  }
  const title = known ? known.title : name;
  let how = '';
  if (process.platform === 'win32' && known && known.winget)
    how = ` It can be installed with: winget install --id ${known.winget} -e --accept-source-agreements --accept-package-agreements`;
  return {
    installed: false,
    text: `${title} is NOT installed.${how}\nDo not pretend it works. Finish what you can without it, then use ask_user to offer two options: you install it for the user, or the user installs it themselves.`,
  };
}

let oemLabel;
// cmd.exe prints in the OEM code page, not UTF-8.
function decodeOutput(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {}
  if (process.platform !== 'win32') return buf.toString('utf8');
  if (!oemLabel) {
    const r = spawnSync('cmd', ['/c', 'chcp'], { encoding: 'latin1', windowsHide: true });
    const cp = ((r.stdout || '').match(/(\d{3,5})/) || [])[1];
    oemLabel =
      {
        866: 'ibm866',
        1250: 'windows-1250',
        1251: 'windows-1251',
        1252: 'windows-1252',
        1254: 'windows-1254',
        932: 'shift_jis',
        936: 'gbk',
        949: 'euc-kr',
        950: 'big5',
      }[cp] || 'latin1';
  }
  try {
    return new TextDecoder(oemLabel).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

function runCommand(cwd, command, { signal, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const chunks = [];
    const output = () => decodeOutput(Buffer.concat(chunks));
    let done = false;
    const kill = () => {
      if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const finish = (note, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, text: note });
    };
    const timer = setTimeout(() => {
      kill();
      finish(
        `Command timed out after ${timeoutMs / 1000}s and was stopped. Output so far:\n${clip(output(), 3000)}\nIf this is a server or a program that waits for input, do not run it; tell the user how to start it.`,
        -1,
      );
    }, timeoutMs);
    const onAbort = () => {
      kill();
      finish('Command was stopped by the user.', -1);
    };
    if (signal) signal.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('error', (e) => finish(`Could not start the command: ${e.message}`, -1));
    child.on('close', (code) => {
      const out = output();
      let text = `Exit code: ${code}\n${clip(out.trim() || '(no output)', 4000)}`;
      const missing =
        code === 9009 ||
        code === 127 ||
        /is not recognized as an internal|command not found|не является внутренней или внешней/i.test(out);
      if (missing) {
        const bin = command.trim().split(/\s+/)[0];
        text += `\nThe program "${bin}" is not installed or not in PATH. Use check_tool to confirm, then ask_user whether you should install it or the user will.`;
      }
      finish(text, code);
    });
  });
}

async function didYouMean(root, wanted) {
  const name = path.basename(String(wanted)).toLowerCase();
  const hits = [];
  async function walk(d, depth) {
    const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (hits.length > 3) return;
      if (e.isDirectory()) {
        if (depth < 4 && !SKIP_DIRS.has(e.name)) await walk(path.join(d, e.name), depth + 1);
      } else if (e.name.toLowerCase() === name) hits.push(relOf(root, path.join(d, e.name)));
    }
  }
  await walk(root, 0);
  return hits.length ? ` Did you mean: ${hits.join(', ')}?` : '';
}

async function execTool(name, args, run) {
  const root = run.root;
  const remember = async (full) => {
    const rel = relOf(root, full);
    if (!(rel in run.snapshots))
      run.snapshots[rel] =
        fs.existsSync(full) && fs.statSync(full).isFile() ? await fsp.readFile(full, 'utf8') : null;
    return rel;
  };
  const track = (rel, after) => {
    const before = run.snapshots[rel];
    const stats = lineStats(before || '', after || '');
    run.changed[rel] = {
      status: after == null ? 'deleted' : before == null ? 'created' : 'modified',
      ...stats,
    };
  };

  switch (name) {
    case 'list_dir':
      return listDir(root, resolveSafe(root, args.path));
    case 'read_file': {
      const full = resolveSafe(root, args.path);
      if (!fs.existsSync(full))
        return `File "${args.path}" does not exist.${await didYouMean(root, args.path)} Use list_dir to see the files.`;
      if (fs.statSync(full).isDirectory()) return `"${args.path}" is a folder. Use list_dir.`;
      const text = docs.isDocument(full)
        ? await docs.extract(full, await fsp.readFile(full))
        : await fsp.readFile(full, 'utf8');
      if (text.includes('\u0000')) return 'This is a binary file and cannot be read as text.';
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, parseInt(args.line, 10) || 1);
      const part = lines.slice(start - 1, start - 1 + MAX_READ_LINES);
      const end = start - 1 + part.length;
      const more =
        end < lines.length
          ? `\n[lines ${start}-${end} of ${lines.length}. To continue: read_file with line=${end + 1}]`
          : `\n[end of file, ${lines.length} lines]`;
      return clip(part.join('\n'), 9000) + more;
    }
    case 'search_text':
      return searchText(root, resolveSafe(root, args.path), args.pattern);
    case 'check_tool':
      return checkTool(args.name).text;
    case 'write_file':
    case 'append_file': {
      const full = resolveSafe(root, args.path);
      const rel = await remember(full);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      let content = cleanContent(args.content);
      const old = fs.existsSync(full) && fs.statSync(full).isFile() ? await fsp.readFile(full, 'utf8') : '';
      if (name === 'append_file') content = old + (old.endsWith('\n') || !old ? '' : '\n') + content;
      run.lastDiff = { before: old, after: content };
      await fsp.writeFile(full, content, 'utf8');
      track(rel, content);
      const check = checkSyntax(full);
      return `Saved ${rel} (${content.split('\n').length} lines, ${content.length} chars).${check ? ' ' + check : ''}`;
    }
    case 'edit_file': {
      const full = resolveSafe(root, args.path);
      if (!fs.existsSync(full)) return `File "${args.path}" does not exist. Create it with write_file.`;
      const rel = await remember(full);
      const old = await fsp.readFile(full, 'utf8');
      const res = applyEdit(old, args.find, args.replace);
      if (res.error) return 'Edit FAILED: ' + res.error;
      await fsp.writeFile(full, res.text, 'utf8');
      run.lastDiff = { before: old, after: res.text };
      track(rel, res.text);
      const check = checkSyntax(full);
      return `Edited ${rel}${res.fuzzy ? ' (matched ignoring indentation)' : ''}.${check ? ' ' + check : ''}`;
    }
    case 'make_dir': {
      const full = resolveSafe(root, args.path);
      await fsp.mkdir(full, { recursive: true });
      return `Folder ${relOf(root, full)} is ready.`;
    }
    case 'delete_file': {
      const full = resolveSafe(root, args.path);
      if (full === root) return 'Refused: cannot delete the project folder itself.';
      if (!fs.existsSync(full)) return `"${args.path}" does not exist, nothing to delete.`;
      const isFile = fs.statSync(full).isFile();
      const rel = isFile ? await remember(full) : relOf(root, full);
      const trash = path.join(root, '.ember-trash', Date.now() + '-' + path.basename(full));
      await fsp.mkdir(path.dirname(trash), { recursive: true });
      await fsp.rename(full, trash);
      if (isFile) track(rel, null);
      return `Deleted ${rel} (kept in .ember-trash, can be restored).`;
    }
    case 'run_command':
      return (await runCommand(root, String(args.command), { signal: run.signal })).text;
    case 'find_code':
      return require('./search').find(root, String(args.query), run.embed);
    case 'web_search':
      return web.search(args.query);
    case 'web_fetch':
      return web.fetchPage(args.url);
    default:
      return `Unknown tool "${name}". Use one of: ${TOOLS.map((t) => t.name).join(', ')}.`;
  }
}

module.exports = {
  TOOLS,
  TOOL_MAP,
  KNOWN_PROGRAMS,
  execTool,
  commandRisk,
  resolveSafe,
  clip,
  applyEdit,
  cleanContent,
  checkTool,
  checkSyntax,
  lineStats,
  decodeOutput,
  SKIP_DIRS,
};
