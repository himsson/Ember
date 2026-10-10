const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function git(cwd, args, env) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const isRepo = (cwd) =>
  !!cwd && fs.existsSync(cwd) && git(cwd, ['rev-parse', '--is-inside-work-tree']).out === 'true';

function status(cwd) {
  if (!isRepo(cwd)) return null;
  const lines = git(cwd, ['status', '--porcelain']).out.split('\n').filter(Boolean);
  return {
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main',
    changed: lines.length,
    files: lines.slice(0, 50).map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3) })),
  };
}

// Snapshot of the whole tree under refs/ember/, built with a throwaway index so the user's branch and staging area are untouched.
function checkpoint(cwd, label) {
  if (!isRepo(cwd)) return null;
  const index = path.join(os.tmpdir(), `ember-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    const head = git(cwd, ['rev-parse', '--verify', 'HEAD']);
    if (head.ok) git(cwd, ['read-tree', 'HEAD'], env);
    if (!git(cwd, ['add', '-A'], env).ok) return null;
    const tree = git(cwd, ['write-tree'], env);
    if (!tree.ok) return null;
    const args = [
      '-c',
      'user.name=Ember',
      '-c',
      'user.email=ember@localhost',
      'commit-tree',
      tree.out,
      '-m',
      'Ember checkpoint: ' + String(label).replace(/\s+/g, ' ').slice(0, 80),
    ];
    if (head.ok) args.push('-p', head.out);
    const commit = git(cwd, args);
    if (!commit.ok) return null;
    const ref = 'refs/ember/checkpoints/' + Date.now();
    return git(cwd, ['update-ref', ref, commit.out]).ok ? ref : null;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

function restore(cwd, ref) {
  if (!/^refs\/ember\/checkpoints\/\d+$/.test(ref) || !isRepo(cwd)) throw new Error('Checkpoint not found');
  const r = git(cwd, ['restore', '--source=' + ref, '--worktree', '--', '.']);
  if (!r.ok) throw new Error(r.err || 'Could not restore the checkpoint');
}

function commit(cwd, message) {
  if (!isRepo(cwd)) throw new Error('This folder is not a git repository');
  if (!git(cwd, ['status', '--porcelain']).out) throw new Error('Nothing to commit');
  git(cwd, ['add', '-A']);
  const r = git(cwd, ['commit', '-m', String(message).trim() || 'Update']);
  if (!r.ok) throw new Error((r.err || r.out).split('\n')[0] || 'Commit failed');
}

module.exports = { isRepo, status, checkpoint, restore, commit };
