param(
    [string]$HostName = "root@47.100.65.191",
    [string]$AppDir = "/opt/terminal_copilot",
    [string]$Branch = "feat/real-terminal-pty-iteration-1",
    [string]$Service = "terminal-copilot",
    [string]$PythonBin = "/usr/bin/python3.11"
)

$ErrorActionPreference = "Stop"

& "$env:WINDIR\System32\OpenSSH\scp.exe" -o BatchMode=yes -o StrictHostKeyChecking=no `
  "scripts/setup_terminal_privilege_mode.sh" "${HostName}:${AppDir}/scripts/setup_terminal_privilege_mode.sh"

$remoteScript = @"
set -euo pipefail
cd "$AppDir"
git fetch origin "$Branch"
git checkout "$Branch"
git pull --ff-only origin "$Branch"

if [ ! -x .venv/bin/python ]; then
  "$PythonBin" -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt

chmod +x scripts/setup_terminal_privilege_mode.sh
./scripts/setup_terminal_privilege_mode.sh "$AppDir" "$Service"

systemctl restart "$Service"
sleep 3

echo "--- git ---"
git rev-parse HEAD
git branch --show-current

echo "--- health ---"
curl -fsS http://127.0.0.1:8000/api/health
echo

echo "--- llm ---"
curl -fsS http://127.0.0.1:8000/api/llm/status
echo

echo "--- service ---"
systemctl --no-pager --full status "$Service" | sed -n '1,40p'

echo "--- pty user ---"
systemctl show -p Environment "$Service" | sed -n '1,20p'
"@

Write-Host "[deploy] host=$HostName"
Write-Host "[deploy] app_dir=$AppDir"
Write-Host "[deploy] branch=$Branch"
Write-Host "[deploy] service=$Service"

& "$env:WINDIR\System32\OpenSSH\ssh.exe" -o BatchMode=yes -o StrictHostKeyChecking=no $HostName $remoteScript
