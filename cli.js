#!/usr/bin/env node
const readline = require('readline');
const path = require('path');
const store = require('./server/store');
const agent = require('./server/agent');
const providers = require('./server/providers');
const engine = require('./server/engine');

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = paint(2);
const bold = paint(1);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const accent = paint('38;5;208');

const MODES = { auto: 'auto', acceptEdits: 'accept edits', manual: 'manual', plan: 'plan' };
const EFFORTS = ['low', 'medium', 'high', 'extra', 'ultra'];
const LABEL = {
  list_dir: 'List',
  read_file: 'Read',
  search_text: 'Search',
  check_tool: 'Check',
  write_file: 'Write',
  append_file: 'Append',
  edit_file: 'Edit',
  make_dir: 'New folder',
  delete_file: 'Delete',
  run_command: 'Run',
  use_skill: 'Skill',
};
const fmt = (text, vars) =>
  String(text).replace(/\{(\d)\}/g, (m, n) => (vars && vars[n] != null ? vars[n] : m));

function parseArgs(argv) {
  const out = { dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--model' || a === '-m') out.model = argv[++i];
    else if (a === '--mode') out.mode = argv[++i];
    else if (a === '--effort') out.effort = argv[++i];
    else if (a === '--dir' || a === '-C') out.dir = path.resolve(argv[++i]);
    else if (a === '--print' || a === '-p') out.print = argv[++i];
  }
  return out;
}

const HELP = `${bold('ember')} — an agent on local models

  ember                      start in the current folder
  ember -p "task"            run one task and exit
  ember -m qwen3:8b          choose a model (default: auto)
  ember --mode auto          auto | acceptEdits | manual | plan
  ember --effort high        low | medium | high | extra | ultra
  ember -C path              work in another folder

In the chat: /model /mode /effort /models /compact /undo /clear /help /exit
Ctrl+C stops the agent, press it again to quit.`;

function diffPreview(d) {
  const a = d.before ? d.before.split('\n') : [];
  const b = d.after ? d.after.split('\n') : [];
  const count = (arr) => arr.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const lines = [];
  for (const l of a)
    if ((cb.get(l) || 0) < ca.get(l)) (lines.push(red('    − ' + l)), ca.set(l, ca.get(l) - 1));
  const ca2 = count(a);
  for (const l of b)
    if ((ca2.get(l) || 0) < cb.get(l)) (lines.push(green('    + ' + l)), cb.set(l, cb.get(l) - 1));
  const more = lines.length > 14 ? [dim(`    … ${lines.length - 14} more lines`)] : [];
  return lines.slice(0, 14).concat(more).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);

  const settings = store.getSettings();
  const session = store.newSession({
    cwd: args.dir,
    mode: MODES[args.mode] ? args.mode : settings.defaultMode,
    effort: EFFORTS.includes(args.effort) ? args.effort : settings.defaultEffort,
  });
  const installed = await providers.listInstalled(settings);
  const find = (name) =>
    installed.models.find((m) => m.id === name || m.tag === name || m.tag === name + ':latest');
  if (args.model) {
    const m = find(args.model);
    if (!m)
      return console.log(
        red(`Model ${args.model} is not installed.`) +
          ' Installed: ' +
          installed.models.map((x) => x.tag).join(', '),
      );
    session.model = m.id;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const printed = new Set();
  let lastOptions = [];
  let loadingShown = false;

  agent.bus.on('event', async (ev) => {
    if (ev.sid !== session.id) return;
    if (ev.type === 'state') {
      if (ev.state.phase === 'loading' && !loadingShown) {
        loadingShown = true;
        console.log(dim(`  ${ev.state.activeModel} is starting…`));
      }
      return;
    }
    if (ev.type !== 'item') return;
    const it = ev.item;
    if (it.type === 'thought') {
      if (it.live || !it.text || printed.has(it.id)) return;
      printed.add(it.id);
      return console.log(dim('  ' + it.text.split('\n').join('\n  ')));
    }
    if (it.type === 'tool') {
      const target = (it.args && (it.args.path || it.args.command || it.args.pattern || it.args.name)) || '';
      if (it.status === 'ask' && !printed.has(it.id + 'ask')) {
        printed.add(it.id + 'ask');
        console.log(yellow(`\n  ${LABEL[it.tool] || it.tool}: ${target}`));
        if (it.risk === 'dangerous') console.log(red('  This command may delete data'));
        if (it.risk === 'install') console.log(yellow('  This command will download or install a program'));
        if (it.preview) console.log(diffPreview(it.preview));
        const a = (await ask(`  Allow? ${bold('y')} yes · ${bold('a')} always · ${bold('n')} no › `))
          .trim()
          .toLowerCase();
        return void agent.answerPermission(
          session.id,
          it.id,
          a.startsWith('a') ? 'always' : a.startsWith('y') || a === '' ? 'allow' : 'deny',
        );
      }
      if ((it.status !== 'ok' && it.status !== 'fail') || printed.has(it.id)) return;
      printed.add(it.id);
      console.log(
        `  ${it.status === 'ok' ? green('✓') : red('✗')} ${LABEL[it.tool] || it.tool} ${bold(target)}${it.denied ? dim(' denied') : ''}`,
      );
      if (it.diff) console.log(diffPreview(it.diff));
      else if (it.status === 'fail' && it.result)
        console.log(dim('    ' + String(it.result).split('\n').slice(0, 6).join('\n    ')));
      return;
    }
    if (printed.has(it.id)) return;
    printed.add(it.id);
    if (it.type === 'notice')
      console.log(
        it.kind === 'model'
          ? accent('◆ ' + it.text) + (it.ctx ? dim(` · context ${it.ctx}`) : '')
          : dim('  ' + fmt(it.text, it.vars) + (it.kind === 'loop' && it.detail ? ' ' + it.detail : '')),
      );
    else if (it.type === 'assistant') console.log('\n' + it.text + '\n');
    else if (it.type === 'error')
      console.log(red('\n' + fmt(it.text, it.vars) + (it.hint ? ' ' + it.hint : '')) + '\n');
    else if (it.type === 'question') {
      lastOptions = it.options || [];
      console.log('\n' + it.text);
      lastOptions.forEach((o, i) => console.log(`  ${bold(i + 1)}. ${o}`));
      console.log('');
    }
  });

  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    rl.close();
    await engine.shutdown(store.getSettings());
    process.exit(0);
  };
  rl.on('SIGINT', () => (agent.isRunning(session.id) ? agent.stop(session.id) : quit()));
  rl.on('close', () => !agent.isRunning(session.id) && quit());

  if (args.print) {
    await agent.send(session.id, args.print);
    return quit();
  }

  const real = installed.models;
  const line = () =>
    dim(
      `  model: ${session.model === 'auto' ? 'auto' : session.model} · mode: ${MODES[session.mode]} · reasoning: ${session.effort} · /help`,
    );
  console.log(`\n${accent('◆')} ${bold('Ember')} ${dim(args.dir)}`);
  console.log(line());
  if (!real.length) console.log(yellow('  No models yet. Install one in the app or with "ollama pull".'));
  console.log('');

  const commands = {
    help: () => console.log(HELP),
    exit: quit,
    quit,
    models: () =>
      installed.models.forEach((m) => console.log(`  ${m.tag}${m.sizeGB ? dim(` · ${m.sizeGB} GB`) : ''}`)),
    model: (v) => {
      if (!v || v === 'auto') session.model = 'auto';
      else if (find(v)) session.model = find(v).id;
      else return console.log(red('  No such model. /models lists them'));
      console.log(line());
    },
    mode: (v) =>
      MODES[v]
        ? ((session.mode = v), console.log(line()))
        : console.log(dim('  ' + Object.keys(MODES).join(' | '))),
    effort: (v) =>
      EFFORTS.includes(v)
        ? ((session.effort = v), console.log(line()))
        : console.log(dim('  ' + EFFORTS.join(' | '))),
    compact: () => agent.compactNow(session.id),
    undo: () => console.log(dim(`  files reverted: ${agent.undo(session.id)}`)),
    clear: () => {
      Object.assign(session, { ctx: [], items: [], plan: [], changed: {}, snapshots: {} });
      console.log(dim('  history cleared'));
    },
  };

  for (;;) {
    let text = (await ask(accent('› '))).trim();
    if (!text) continue;
    const cmd = text.match(/^\/(\w+)\s*(.*)$/);
    if (cmd && commands[cmd[1]]) {
      try {
        await commands[cmd[1]](cmd[2].trim());
      } catch (e) {
        console.log(red('  ' + e.message));
      }
      continue;
    }
    if (/^\d$/.test(text) && lastOptions[Number(text) - 1]) text = lastOptions[Number(text) - 1];
    lastOptions = [];
    loadingShown = false;
    await agent.send(session.id, text);
  }
}

main().catch((e) => {
  console.error(red(e.message));
  process.exit(1);
});
