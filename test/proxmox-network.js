import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const launcher = readFileSync(new URL('../proxmox/open-tabletop.sh', import.meta.url), 'utf8');
const networkCheck = launcher.match(/^ensure_container_network\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(networkCheck, 'the Proxmox network check must be available to exercise');

const harness = `set -euo pipefail
${networkCheck}
CTID=123
reboots=0
pct() {
  local ready=0
  if [[ "$1" == reboot ]]; then
    reboots=$((reboots + 1))
    return 0
  fi
  [[ "$1" == exec ]] || return 2
  case "$SCENARIO" in
    immediate|no_route) ready=1 ;;
    after_reboot) if (( reboots > 0 )); then ready=1; fi ;;
  esac
  if (( ready == 1 )); then
    if [[ "$6" == -o ]]; then
      printf '2: eth0 inet 10.10.15.100/24 brd 10.10.15.255 scope global eth0\\n'
    elif [[ "$6" == route && "$SCENARIO" != no_route ]]; then
      printf 'default via 10.10.15.254 dev eth0\\n'
    fi
  fi
}
sleep() { :; }
fail() { printf 'FAIL: %s\\n' "$*" >&2; return 1; }
if ensure_container_network; then
  printf 'RESULT=ready REBOOTS=%s\\n' "$reboots"
else
  printf 'RESULT=failed REBOOTS=%s\\n' "$reboots"
fi`;

for (const [scenario, result, reboots] of [
  ['immediate', 'ready', 0],
  ['after_reboot', 'ready', 1],
  ['no_route', 'failed', 1],
  ['never', 'failed', 1],
]) {
  test(`Proxmox network check: ${scenario}`, () => {
    const run = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: { ...process.env, SCENARIO: scenario },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`RESULT=${result} REBOOTS=${reboots}`));
    if (result === 'ready') {
      assert.match(run.stdout, /network ready: 10\.10\.15\.100/);
    } else {
      assert.match(run.stderr, /still has no IPv4 address and default route after reboot/);
    }
  });
}
