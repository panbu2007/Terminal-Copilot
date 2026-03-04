#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-root@47.100.65.191}"
APP_DIR="${DEPLOY_APP_DIR:-/opt/terminal_copilot}"
BRANCH="${DEPLOY_BRANCH:-feat/real-terminal-pty-iteration-1}"
SERVICE="${DEPLOY_SERVICE:-terminal-copilot}"
PYTHON_BIN="${DEPLOY_PYTHON_BIN:-/usr/bin/python3.11}"

echo "[deploy] host=${HOST}"
echo "[deploy] app_dir=${APP_DIR}"
echo "[deploy] branch=${BRANCH}"
echo "[deploy] service=${SERVICE}"

ssh -o BatchMode=yes -o StrictHostKeyChecking=no "${HOST}" bash <<EOF
set -euo pipefail

cd "${APP_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

if [ ! -x .venv/bin/python ]; then
  "${PYTHON_BIN}" -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt

systemctl restart "${SERVICE}"
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
systemctl --no-pager --full status "${SERVICE}" | sed -n '1,40p'
EOF
