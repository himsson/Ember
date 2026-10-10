const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');
const agent = require('./agent');

const TASKS = [
  {
    ask: 'Create a file hello.txt that contains exactly this one line: Hello from Ember',
    check: (dir) => fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8').trim() === 'Hello from Ember',
  },
  {
    files: { 'config.json': '{\n  "name": "demo",\n  "port": 3000,\n  "debug": false\n}\n' },
    ask: 'In config.json change the port to 8080. Do not change anything else.',
    check: (dir) => {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      return j.port === 8080 && j.name === 'demo' && j.debug === false;
    },
  },
  {
    files: { 'sum.js': 'function sum(a, b) {\n  return a - b;\n}\n\nmodule.exports = sum;\n' },
    ask: 'sum.js should add two numbers, but it subtracts them. Fix the bug.',
    check: (dir) => {
      const r = spawnSync(
        process.execPath,
        ['-e', 'process.exit(require(process.argv[1])(2, 3) === 5 ? 0 : 1)', path.join(dir, 'sum.js')],
        { timeout: 8000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      );
      return r.status === 0;
    },
  },
];

const running = new Set();

async function run(modelId, onProgress) {
  if (running.has(modelId)) return null;
  running.add(modelId);
  let score = 0;
  try {
    for (let i = 0; i < TASKS.length; i++) {
      onProgress({ step: i + 1, total: TASKS.length, score });
      const task = TASKS[i];
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-test-'));
      for (const [name, text] of Object.entries(task.files || {}))
        fs.writeFileSync(path.join(dir, name), text);
      const s = store.newSession({ cwd: dir, model: modelId, mode: 'auto', effort: 'low', hidden: true });
      try {
        await agent.send(s.id, task.ask);
        if (task.check(dir)) score++;
      } catch {}
      store.deleteSession(s.id);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const tests = {
      ...(store.getSettings().modelTests || {}),
      [modelId]: { score, total: TASKS.length, at: Date.now() },
    };
    store.saveSettings({ modelTests: tests });
    return { score, total: TASKS.length };
  } finally {
    running.delete(modelId);
  }
}

module.exports = { run, TASKS, isRunning: (id) => running.has(id) };
