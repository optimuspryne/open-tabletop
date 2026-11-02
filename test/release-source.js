import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const guard = fileURLToPath(new URL('../scripts/verify-release.sh', import.meta.url));

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'tabletop-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync(
      'git',
      ['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', ...args],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'main');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Stable baseline');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const verify = (tag = 'v0.24.0') =>
    spawnSync('bash', [guard], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REF_NAME: tag },
    });
  return { git, verify };
}

test('release guard accepts a stable tag at main', (t) => {
  const { verify } = repository(t);
  for (const tag of ['v0.0.0', 'v0.24.0', 'v1.0.0', 'v12.34.56']) {
    const result = verify(tag);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('release guard rejects development-only commits', (t) => {
  const { git, verify } = repository(t);
  git('checkout', '-b', 'dev');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Unreleased work');
  const result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be merged into main/);
});

test('release guard accepts a development commit after promotion to main', (t) => {
  const { git, verify } = repository(t);
  git('checkout', '-b', 'dev');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Tested feature');
  const feature = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  git('-c', 'commit.gpgsign=false', 'merge', '--no-ff', 'dev', '-m', 'Promote release');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '--detach', feature);
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
});

test('release guard rejects prerelease tags and malformed versions', (t) => {
  const { verify } = repository(t);
  for (const tag of [
    'v0.24.0-rc.1',
    'v0.24.0-dev',
    'v0.24.0+build.1',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2',
    'vnext',
    'dev',
    '',
  ]) {
    const result = verify(tag);
    assert.equal(result.status, 1, tag);
    assert.match(result.stderr, /require a vX.Y.Z tag/);
  }
});

test('release guard fails closed when main history is unavailable', (t) => {
  const { git, verify } = repository(t);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const result = verify();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot verify origin\/main/);
});
