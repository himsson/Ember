const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    } catch {
      return resolve(false);
    }
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

async function unpack(file, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    // Git and MSYS ship a tar that can't read zip; the system one (bsdtar) can.
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(systemTar) && (await run(systemTar, ['-xf', file, '-C', dir]))) return;
    const quote = (s) => "'" + s.replace(/'/g, "''") + "'";
    if (
      await run('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(dir)} -Force`,
      ])
    )
      return;
  } else if (await run('tar', [/\.zst$/.test(file) ? '--zstd' : '-a', '-xf', file, '-C', dir])) return;
  throw new Error('Could not unpack ' + path.basename(file));
}

module.exports = { unpack };
