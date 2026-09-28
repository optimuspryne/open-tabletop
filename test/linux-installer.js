import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installer = fileURLToPath(new URL('../proxmox/install.sh', import.meta.url));
const launcher = fileURLToPath(new URL('../linux/open-tabletop.sh', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function bash(script, env = {}) {
  return spawnSync('bash', ['-c', `set -euo pipefail\n${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

for (const [id, version, profile, service] of [
  ['debian', '12', 'linux', 'redis-server'],
  ['debian', '13', 'linux', 'redis-server'],
  ['ubuntu', '22.04', 'linux', 'redis-server'],
  ['ubuntu', '24.04', 'linux', 'redis-server'],
  ['ubuntu', '26.04', 'linux', 'redis-server'],
  ['fedora', '43', 'linux', 'valkey'],
  ['arch', '', 'linux', 'valkey'],
  ['debian', '13', 'proxmox', 'redis-server'],
]) {
  test(`native installer selects services for ${profile}/${id}/${version}`, () => {
    const run = bash(`source "$INSTALLER"; detect_platform; echo "$cache_service"`, {
      INSTALLER: installer,
      ID: id,
      VERSION_ID: version,
      profile,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), service);
  });
}

for (const [id, version, profile] of [
  ['alpine', '3.22', 'linux'],
  ['debian', '11', 'linux'],
  ['ubuntu', '20.04', 'linux'],
  ['debian', '12', 'proxmox'],
]) {
  test(`native installer rejects ${profile}/${id}/${version}`, () => {
    const run = bash(`source "$INSTALLER"; detect_platform`, {
      INSTALLER: installer,
      ID: id,
      VERSION_ID: version,
      profile,
    });
    assert.notEqual(run.status, 0);
  });
}

test('Linux allocates a system account; Proxmox retains its NFS UID mapping', () => {
  for (const profile of ['linux', 'proxmox']) {
    const run = bash(
      `source "$INSTALLER"
getent() { return 2; }
groupadd() { echo "groupadd $*"; }
useradd() { echo "useradd $*"; }
create_app_user`,
      { INSTALLER: installer, profile },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      profile === 'linux'
        ? /useradd --system --gid open-tabletop/
        : /useradd --uid 1000 --gid 1000/,
    );
  }
  const conflict = bash(`source "$INSTALLER"; getent() { return 0; }; create_app_user`, {
    INSTALLER: installer,
    profile: 'linux',
  });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /already exists/);
});

test('APT retries failure and stops after three attempts', () => {
  const run = bash(
    `source "$INSTALLER"
apt-get() { echo attempt; return 1; }
sleep() { :; }
apt_update`,
    { INSTALLER: installer },
  );
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout.trim().split('\n').length, 3);
});

// Exercise the real install/upgrade orchestration in a temporary filesystem.
// Only privilege checks and absolute system paths are remapped; service/package
// commands are mocked so tests never install software or touch the host database.
function fixture(t, id = 'fedora', profile = 'linux') {
  const root = mkdtempSync(join(tmpdir(), 'tabletop-install-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    'etc/systemd/system',
    'run/systemd/system',
    'usr/bin',
    'root',
    'src',
    'work',
  ]) {
    mkdirSync(join(root, path), { recursive: true });
  }
  // CI can install Node in a tool cache instead of /usr/bin. Keep the real
  // runtime validation, but resolve its executable inside the fixture too.
  symlinkSync(process.execPath, join(root, 'usr/bin/node'));
  writeFileSync(join(root, 'etc/os-release'), `ID=${id}\nVERSION_ID=13\n`);
  writeFileSync(join(root, 'hba'), 'local all all peer\nhost all all 127.0.0.1/32 ident\n');
  mkdirSync(join(root, 'src/proxmox'));
  writeFileSync(join(root, 'src/proxmox/install.sh'), readFileSync(installer));
  for (const file of ['package.json', 'package-lock.json', 'server.js']) {
    writeFileSync(join(root, 'src', file), '{}');
  }
  const archive = join(root, 'source.tar');
  const packed = bash(
    `tar -cf "$ARCHIVE" -C "$ROOT/src" proxmox/install.sh package.json package-lock.json server.js`,
    { ROOT: root, ARCHIVE: archive },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const source = readFileSync(installer, 'utf8')
    .replaceAll('[[ $EUID -eq 0 ]]', 'true')
    .replace(
      /\/(?:etc|opt|root|var\/lib|var\/backups|run\/systemd|usr\/share)(?=\/)/g,
      (path) => `${root}${path}`,
    )
    .replaceAll('/usr/bin/node', join(root, 'usr/bin/node'));
  writeFileSync(join(root, 'installer.sh'), source);
  const mocks = `
source "$ROOT/installer.sh"
log() { echo "$*" >> "$ROOT/calls"; }
install_packages() { log packages; }
initialize_postgres() { log initdb; }
getent() { return 2; }
groupadd() { log "groupadd $*"; }
useradd() { log "useradd $*"; }
chown() { :; }
install() {
  local args=()
  while (( $# )); do
    case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
  done
  command install "\${args[@]}"
}
systemctl() { log "systemctl $*"; }
pg_isready() { return 0; }
valkey-cli() { echo PONG; }
redis-cli() { echo PONG; }
runuser() {
  shift 3
  case "$1" in
    psql)
      if [[ "$*" == *'SHOW hba_file'* ]]; then echo "$ROOT/hba"; fi
      ;;
    pg_dump) log dump; [[ "\${FAIL_DUMP:-0}" == 0 ]] || return 1; echo backup ;;
    *) "$@" ;;
  esac
}
npm() { log "npm $*"; [[ "\${FAIL_NPM:-0}" == 0 ]]; }
curl() { [[ "\${FAIL_HTTP:-0}" == 0 ]]; }
sleep() { :; }
SOURCE_ID=$(sha256sum "$SOURCE_ARCHIVE" | awk '{ print substr($1, 1, 40) }')
`;
  const env = {
    ROOT: root,
    SOURCE_ARCHIVE: archive,
    OTT_INSTALL_PROFILE: profile,
    BOOTSTRAP_ADMIN_USERNAME: 'admin',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  };
  return {
    root,
    env,
    run: (mode, extra = {}) => bash(`${mocks}\nmain ${mode}`, { ...env, ...extra }),
  };
}

for (const [id, profile, cache] of [
  ['fedora', 'linux', 'valkey'],
  ['debian', 'proxmox', 'redis-server'],
]) {
  test(`${profile} install and update retain credentials and back up before activation`, (t) => {
    const f = fixture(t, id, profile);
    const first = f.run('install');
    assert.equal(first.status, 0, first.stderr);
    const unit = readFileSync(join(f.root, 'etc/systemd/system/open-tabletop.service'), 'utf8');
    assert.match(unit, new RegExp(`Requires=postgresql.service ${cache}.service`));
    const credentials = readFileSync(join(f.root, 'root/open-tabletop-credentials.txt'), 'utf8');
    const config = readFileSync(join(f.root, 'etc/open-tabletop/open-tabletop.env'), 'utf8');
    assert.match(config, /DATABASE_USER=tabletop_app\n/);
    assert.match(config, /MIGRATE_DATABASE_USER=tabletop\n/);
    if (profile === 'linux') {
      assert.equal(
        readFileSync(join(f.root, 'hba'), 'utf8'),
        'host tabletop tabletop,tabletop_app 127.0.0.1/32 scram-sha-256\nlocal all all peer\nhost all all 127.0.0.1/32 ident\n',
      );
    }
    writeFileSync(join(f.root, 'calls'), '');
    const updated = f.run('upgrade');
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(
      readFileSync(join(f.root, 'root/open-tabletop-credentials.txt'), 'utf8'),
      credentials,
    );
    assert.equal(readFileSync(join(f.root, 'etc/open-tabletop/open-tabletop.env'), 'utf8'), config);
    const calls = readFileSync(join(f.root, 'calls'), 'utf8');
    assert.ok(calls.indexOf('dump') < calls.indexOf('systemctl restart'));
    assert.doesNotMatch(calls, /packages|initdb|useradd/);
    assert.equal(readdirSync(join(f.root, 'var/backups/open-tabletop')).length, 1);
    const current = readlinkSync(join(f.root, 'opt/open-tabletop/current'));
    writeFileSync(join(f.root, 'calls'), '');
    const failed = f.run('upgrade', { FAIL_DUMP: '1' });
    assert.notEqual(failed.status, 0);
    assert.equal(readlinkSync(join(f.root, 'opt/open-tabletop/current')), current);
    assert.doesNotMatch(readFileSync(join(f.root, 'calls'), 'utf8'), /systemctl restart/);
  });
}

test('native installer stops before activation on dependency failure', (t) => {
  const f = fixture(t);
  const failed = f.run('install', { FAIL_NPM: '1' });
  assert.notEqual(failed.status, 0);
  assert.doesNotMatch(readFileSync(join(f.root, 'calls'), 'utf8'), /systemctl restart/);
  const retry = f.run('upgrade');
  assert.notEqual(retry.status, 0); // incomplete installs are not silently treated as updates
});

test('native installer reports failed HTTP readiness', (t) => {
  const f = fixture(t);
  assert.equal(f.run('install').status, 0);
  const failed = f.run('upgrade', { FAIL_HTTP: '1' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /did not become ready/);
});

for (const [id, profile, expected] of [
  ['debian', 'linux', 'nodejs postgresql'],
  ['ubuntu', 'linux', 'nodejs postgresql'],
  ['debian', 'proxmox', 'nodejs postgresql-16'],
  ['fedora', 'linux', 'dnf install -y'],
  ['arch', 'linux', 'pacman -Syu --needed --noconfirm'],
]) {
  test(`native package setup: ${profile}/${id}`, (t) => {
    const f = fixture(t, id, profile);
    mkdirSync(join(f.root, 'etc/apt/sources.list.d'), { recursive: true });
    const run = bash(
      `source "$ROOT/installer.sh"
ID="$DISTRO"; profile="$OTT_INSTALL_PROFILE"
apt-get() { echo "apt-get $*"; }
dnf() { echo "dnf $*"; }
pacman() { echo "pacman $*"; }
curl() { touch "\${@: -1}"; }
gpg() { while [[ "$1" != -o ]]; do shift; done; touch "$2"; }
node() { echo 26; }
install_packages`,
      { ...f.env, DISTRO: id },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(expected), run.stdout);
    if (id === 'debian' || id === 'ubuntu') {
      assert.match(
        readFileSync(join(f.root, 'etc/apt/sources.list.d/nodesource.sources'), 'utf8'),
        /node_26/,
      );
      const entries = readdirSync(join(f.root, 'etc/apt/sources.list.d'));
      assert.equal(entries.includes('pgdg.sources'), profile === 'proxmox');
    }
  });
}

for (const [id, dataDir, expected] of [
  ['fedora', 'var/lib/pgsql/data', /postgresql-setup --initdb --unit postgresql/],
  ['arch', 'var/lib/postgres/data', /--auth-local=peer --auth-host=scram-sha-256/],
]) {
  test(`database initialization on ${id} preserves existing clusters`, (t) => {
    const f = fixture(t, id);
    const script = `source "$ROOT/installer.sh"
ID="$DISTRO"
postgresql-setup() { echo "postgresql-setup $*"; }
runuser() { echo "$*"; }
initialize_postgres`;
    const first = bash(script, { ...f.env, DISTRO: id });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, expected);
    mkdirSync(join(f.root, dataDir), { recursive: true });
    writeFileSync(join(f.root, dataDir, 'PG_VERSION'), '17');
    const again = bash(script, { ...f.env, DISTRO: id });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, '');
  });
}

test('Linux source preparation matches the archive and rejects missing installer', (t) => {
  const f = fixture(t);
  const run = bash(
    `source "$LAUNCHER"
temp_dir="$ROOT/work"
prepare_source
cmp "$temp_dir/install.sh" "$ROOT/src/proxmox/install.sh"
echo "$source_id"`,
    { ...f.env, LAUNCHER: launcher },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout.trim(), /^[0-9a-f]{40}$/);
  bash(`tar -cf "$SOURCE_ARCHIVE" -C "$ROOT/src" package.json`, f.env);
  const failed = bash(`source "$LAUNCHER"; temp_dir="$ROOT/work"; prepare_source`, {
    ...f.env,
    LAUNCHER: launcher,
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /exactly one proxmox\/install.sh/);
});

test('Linux launcher help is available without root', () => {
  const run = bash(`bash ${quote(launcher)} --help`);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /install\|update/);
});

for (const mode of ['install', 'update']) {
  test(`Linux launcher dispatches ${mode} to the matching Linux-capable installer`, (t) => {
    const f = fixture(t);
    // Only the disposable fixture's extracted installer runs in the child process.
    writeFileSync(
      join(f.root, 'src/proxmox/install.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
[[ "$OTT_INSTALL_PROFILE" == linux ]]
if [[ "$1" == --check-platform ]]; then exit 0; fi
[[ "$SOURCE_ID" == "$(sha256sum "$SOURCE_ARCHIVE" | awk '{ print substr($1, 1, 40) }')" ]]
printf '%s' "$1" > "$ROOT/dispatched"
`,
    );
    const packed = bash(
      'tar -cf "$SOURCE_ARCHIVE" -C "$ROOT/src" proxmox/install.sh package.json package-lock.json server.js',
      f.env,
    );
    assert.equal(packed.status, 0, packed.stderr);
    if (mode === 'update') {
      mkdirSync(join(f.root, 'etc/open-tabletop'));
      writeFileSync(join(f.root, 'etc/open-tabletop/open-tabletop.env'), '');
      mkdirSync(join(f.root, 'opt/open-tabletop'), { recursive: true });
      assert.equal(bash('ln -s /unused "$ROOT/opt/open-tabletop/current"', f.env).status, 0);
    }
    const source = readFileSync(launcher, 'utf8')
      .replaceAll('[[ $EUID -eq 0 ]]', 'true')
      .replace(/\/(?:etc|opt|run\/systemd)(?=\/)/g, (path) => `${f.root}${path}`);
    writeFileSync(join(f.root, 'launcher.sh'), source);
    const run = bash(`bash "$ROOT/launcher.sh" ${mode}`, f.env);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      readFileSync(join(f.root, 'dispatched'), 'utf8'),
      mode === 'update' ? 'upgrade' : 'install',
    );
  });
}
