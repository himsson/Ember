const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const has = (bin) =>
  spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { windowsHide: true }).status === 0;

function detect(root) {
  const exists = (f) => fs.existsSync(path.join(root, f));
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return '';
  }
  if (exists('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const scripts = pkg.scripts || {};
      const needsInstall =
        Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0 && !exists('node_modules');
      if (scripts.test && !/no test specified/.test(scripts.test) && !needsInstall) return 'npm test';
      if (scripts.lint && !needsInstall) return 'npm run lint';
    } catch {}
  }
  const py = has('python') ? 'python' : has('python3') ? 'python3' : '';
  const pyTests = names.some((f) => /^test_.*\.py$|_test\.py$/.test(f));
  if (py && (exists('pytest.ini') || exists('tests') || pyTests)) {
    if (spawnSync(py, ['-c', 'import pytest'], { windowsHide: true }).status === 0)
      return py + ' -m pytest -q';
    if (pyTests) return py + ' -m unittest -q';
  }
  if (exists('go.mod') && has('go')) return 'go test ./...';
  if (exists('Cargo.toml') && has('cargo')) return 'cargo test -q';
  return '';
}

module.exports = { detect };
