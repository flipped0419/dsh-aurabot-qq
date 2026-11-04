#!/usr/bin/env bash
# Install Aurabot 1.1.24 remote-voice support as a separate git worktree.
# This keeps the original 1.1.24-rvc release, stored settings, keys and QQ state.
# Run as root on the Tencent host, ideally via systemd-run to survive SSH drops.
set -Eeuo pipefail
umask 027

OLD=/opt/aurabot/releases/1.1.24-rvc
NEW=/opt/aurabot/releases/1.1.24-voices
LINK=/opt/aurabot/home/.dsh/profiles/web/node_modules/dsh-aurabot-qq
LOCAL=/opt/aurabot/data/local
NODE=/opt/aurabot/node/bin/node
SVC=aurabot-dsh.service
PIN=2e06cd6625e69bcf80ed5e47212a348be0988a31
REF=refs/heads/upgrade/aurabot-1.1.24
BACKUP_DIR=''
ROLLBACK_ARMED=0

fail() {
  echo "FAILED: $*" >&2
  if (( ROLLBACK_ARMED )); then rollback 1; else exit 1; fi
}
rollback() {
  local rc="${1:-$?}"
  trap - ERR
  set +e
  if (( ROLLBACK_ARMED )); then
    echo "ERROR: deployment failed (code $rc); restoring original production link and local adapter" >&2
    if [[ -n "$BACKUP_DIR" && -f "$BACKUP_DIR/song-process.mjs" ]]; then
      install -o aurabot -g aurabot -m 600 "$BACKUP_DIR/song-process.mjs" "$LOCAL/song-process.mjs"
      if [[ -f "$BACKUP_DIR/rvc-voices.json" ]]; then
        install -o aurabot -g aurabot -m 600 "$BACKUP_DIR/rvc-voices.json" "$LOCAL/rvc-voices.json"
      else
        rm -f "$LOCAL/rvc-voices.json"
      fi
    fi
    local temp="${LINK}.rollback.$$"
    rm -f "$temp"
    ln -s "$OLD" "$temp"
    chown -h aurabot:aurabot "$temp"
    mv -Tf "$temp" "$LINK"
    systemctl restart "$SVC"
    echo "ROLLBACK: link=$(readlink -f "$LINK") service=$(systemctl is-active "$SVC")" >&2
  fi
  exit "$rc"
}
trap rollback ERR

[[ "$EUID" == 0 ]] || fail 'run as root'
id aurabot >/dev/null 2>&1 || fail 'missing aurabot service account'
[[ "$(readlink -f "$LINK")" == "$OLD" ]] || fail "production link is not expected $OLD; refuse to overwrite a different deployment"
[[ -f "$OLD/src/host.js" && -f "$OLD/.git" && -f "$LOCAL/song-process.mjs" && -s "$LOCAL/rvc-worker.env" ]] ||
  fail 'missing current release/worktree or existing local song adapter'
[[ -x "$NODE" ]] || fail 'Node executable missing'
systemctl is-active --quiet "$SVC" || fail 'current DSH service not active'

echo 'PRECHECK: verifying InstaBox model registry over existing authenticated HTTPS (no keys printed)'
sudo -u aurabot -H "$NODE" --input-type=module <<'NODE'
import { readFileSync } from 'node:fs'
const cfg = {}
for (const line of readFileSync('/opt/aurabot/data/local/rvc-worker.env', 'utf8').split(/\r?\n/)) {
  const x = line.trim()
  if (!x || x.startsWith('#')) continue
  const sep = x.indexOf('=')
  if (sep < 1) continue
  let value = x.slice(sep + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1)
  cfg[x.slice(0,sep).trim()] = value
}
for (const key of ['RVC_BASE_URL','RVC_PORT_TOKEN','RVC_WORKER_KEY']) {
  if (!cfg[key]) throw new Error('Missing '+key)
}
const url = new URL(cfg.RVC_BASE_URL)
if (url.protocol !== 'https:') throw new Error('Non-HTTPS Worker URL')
const res = await fetch(new URL('/v1/models', url), {
  headers: { Authorization: 'Bearer '+cfg.RVC_PORT_TOKEN, 'X-Worker-Key': cfg.RVC_WORKER_KEY },
  signal: AbortSignal.timeout(30000),
})
if (!res.ok) throw new Error('Worker model check: HTTP '+res.status)
const names = (await res.json()).models || []
const required = ['Fp231.pth','coco.pth','strawberry.pth','eee.pth','maobailing.pth','FeiyuVoice-RVC-v1.pth']
const missing = required.filter(n=>!names.includes(n))
if (missing.length) throw new Error('Missing Worker models: '+missing.join(', '))
console.log('PASS: all six Worker models accessible through private HTTPS')
NODE

echo 'PREPARE: fetching verified Aurabot source as an isolated worktree'
git -c safe.directory="$OLD" -C "$OLD" fetch --quiet --no-tags origin "$REF"
git -c safe.directory="$OLD" -C "$OLD" cat-file -e "${PIN}^{commit}" ||
  fail "expected commit $PIN not fetched"
git -c safe.directory="$OLD" -C "$OLD" merge-base --is-ancestor "$PIN" FETCH_HEAD ||
  fail 'pinned revision is not reachable from the current upgrade branch'
if [[ ! -e "$NEW" ]]; then
  git -c safe.directory="$OLD" -C "$OLD" worktree add --quiet --detach "$NEW" "$PIN"
else
  [[ -f "$NEW/src/local/templates/rvc-voices.json.example" ]] ||
    fail "Existing destination is not the expected release: $NEW"
  [[ "$(git -c safe.directory="$NEW" -C "$NEW" rev-parse HEAD)" == "$PIN" ]] ||
    fail "Existing destination points to a different revision: $NEW"
fi

for f in src/host.js src/local/templates/song-process.mjs src/local/templates/rvc-voices.json.example client/client.js; do
  [[ -f "$NEW/$f" ]] || fail "Missing $f"
done
echo 'TEST: native Aurabot song, local, and adapter suites'
sudo -u aurabot -H "$NODE" --test \
  "$NEW/test/local.test.js" \
  "$NEW/test/song-process-client.test.js" \
  "$NEW/test/song.test.js" ||
  fail 'regression tests failed: production unchanged'

echo 'BACKUP: preserve existing production local adapter and mapping'
[[ ! -L "$LOCAL/song-process.mjs" && ! -L "$LOCAL/rvc-voices.json" ]] ||
  fail 'Refusing symlinked local adapter/mapping'
BACKUP_DIR="/opt/aurabot/backups/voices-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$BACKUP_DIR"
cp -a "$LOCAL/song-process.mjs" "$BACKUP_DIR/song-process.mjs"
if [[ -f "$LOCAL/rvc-voices.json" ]]; then
  cp -a "$LOCAL/rvc-voices.json" "$BACKUP_DIR/rvc-voices.json"
fi
ROLLBACK_ARMED=1

echo 'INSTALL: new local adapter + voice mapping (secrets untouched)'
install -o aurabot -g aurabot -m 600 "$NEW/src/local/templates/song-process.mjs" "$LOCAL/.song-process.mjs.new.$$"
install -o aurabot -g aurabot -m 600 "$NEW/src/local/templates/rvc-voices.json.example" "$LOCAL/.rvc-voices.json.new.$$"
mv -f "$LOCAL/.song-process.mjs.new.$$" "$LOCAL/song-process.mjs"
mv -f "$LOCAL/.rvc-voices.json.new.$$" "$LOCAL/rvc-voices.json"

echo 'SWITCH: atomically update DSH plugin link'
TEMP="${LINK}.new.$$"
ln -s "$NEW" "$TEMP"
chown -h aurabot:aurabot "$TEMP"
mv -Tf "$TEMP" "$LINK"
systemctl restart "$SVC"

READY=0
for _ in $(seq 1 25); do
  if systemctl is-active --quiet "$SVC"; then
    STATUS=$(curl --silent --output /dev/null --max-time 3 --write-out '%{http_code}' http://127.0.0.1:3180/ || true)
    case "$STATUS" in 200|301|302|303|307|308) READY=1; break ;; esac
  fi
  sleep 2
done
[[ "$READY" == 1 ]] || fail 'DSH Web did not become ready after restart'
[[ "$(readlink -f "$LINK")" == "$NEW" ]] || fail 'new symlink target mismatch'
[[ "$(stat -c '%U:%a' "$LOCAL/rvc-worker.env")" == "aurabot:600" ]] ||
  echo 'NOTE: existing credential file permissions differ from recommended aurabot:600; file was NOT changed'
ROLLBACK_ARMED=0
trap - ERR
echo "PASS: 1.1.24-voices active; HTTP $STATUS; backup at $BACKUP_DIR"
echo 'NEXT: open Aurabot -> 翻唱; choose 可可; save; /sing 东西 蓝心羽 @草莓'
