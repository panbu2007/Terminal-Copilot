#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/terminal_copilot}"
SERVICE="${2:-terminal-copilot}"
PTY_USER="${TERMINAL_COPILOT_PTY_USER:-tc-terminal}"
PTY_HOME="${TERMINAL_COPILOT_PTY_HOME:-/home/${PTY_USER}}"
DEMO_ROOT="${TERMINAL_COPILOT_LOCAL_ROOT:-/home/ops}"
DEMO_WORKSPACE="${DEMO_ROOT}/workspace"
DEMO_LOG_DIR="${DEMO_ROOT}/logs"
DEMO_CONFIG_DIR="${DEMO_ROOT}/configs"
DEMO_RUNBOOK_LINK="${DEMO_ROOT}/runbooks"
ENV_DIR="/etc/terminal-copilot"
ENV_FILE="${ENV_DIR}/pty.env"
DROPIN_DIR="/etc/systemd/system/${SERVICE}.service.d"
DROPIN_FILE="${DROPIN_DIR}/10-pty-user.conf"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE}-pty"

if [[ "$(id -u)" != "0" ]]; then
  echo "[privilege-mode] must run as root" >&2
  exit 1
fi

mkdir -p "${ENV_DIR}" "${DROPIN_DIR}"

if ! id -u "${PTY_USER}" >/dev/null 2>&1; then
  useradd --create-home --home-dir "${PTY_HOME}" --shell /bin/bash "${PTY_USER}"
fi

install -d -m 0755 -o "${PTY_USER}" -g "${PTY_USER}" "${PTY_HOME}"
install -d -m 0755 "${DEMO_WORKSPACE}" "${DEMO_LOG_DIR}" "${DEMO_CONFIG_DIR}"

if [[ -d "${APP_DIR}/docs/runbook" ]]; then
  ln -snf "${APP_DIR}/docs/runbook" "${DEMO_RUNBOOK_LINK}"
fi

cat >"${DEMO_CONFIG_DIR}/daemon.json" <<'EOF'
{"registry-mirrors":["https://mirror.ccs.tencentyun.com","https://docker.m.daocloud.io"]}
EOF

cat >"${DEMO_CONFIG_DIR}/nginx.conf" <<'EOF'
server {
    listen 80;
    server_name localhost;
    location / {
        proxy_pass http://127.0.0.1:8000;
    }
}
EOF

cat >"${DEMO_LOG_DIR}/app.log" <<EOF
$(date '+%Y-%m-%d %H:%M:%S') [INFO] terminal-copilot service started
$(date '+%Y-%m-%d %H:%M:%S') [INFO] health check OK
$(date '+%Y-%m-%d %H:%M:%S') [WARN] LLM token not configured, rule-based fallback enabled
EOF

cat >"${DEMO_WORKSPACE}/app.py" <<'EOF'
from fastapi import FastAPI

app = FastAPI(title="demo-service")


@app.get("/")
def root():
    return {"status": "running", "service": "demo"}


@app.get("/health")
def health():
    return {"status": "ok"}
EOF

cat >"${DEMO_WORKSPACE}/requirements.txt" <<'EOF'
fastapi>=0.110
uvicorn>=0.27
EOF

cat >"${ENV_FILE}" <<EOF
TERMINAL_COPILOT_PTY_DROP_USER=${PTY_USER}
TERMINAL_COPILOT_PTY_SHELL=/bin/bash
TERMINAL_COPILOT_LOCAL_ROOT=${DEMO_ROOT}
EOF
chmod 0644 "${ENV_FILE}"

cat >"${DROPIN_FILE}" <<EOF
[Service]
EnvironmentFile=-${ENV_FILE}
EOF

systemctl daemon-reload

systemctl_bin="$(command -v systemctl)"
journalctl_bin="$(command -v journalctl)"
ss_bin="$(command -v ss || true)"
lsof_bin="$(command -v lsof || true)"
timedatectl_bin="$(command -v timedatectl || true)"
nginx_bin="$(command -v nginx || true)"
ufw_bin="$(command -v ufw || true)"
firewall_cmd_bin="$(command -v firewall-cmd || true)"
iptables_bin="$(command -v iptables || true)"
docker_bin="$(command -v docker || true)"

allowed_commands=(
  "${systemctl_bin} daemon-reload"
  "${systemctl_bin} status *"
  "${systemctl_bin} show *"
  "${systemctl_bin} is-active *"
  "${systemctl_bin} start *"
  "${systemctl_bin} stop *"
  "${systemctl_bin} restart *"
  "${systemctl_bin} reload *"
  "${systemctl_bin} enable *"
  "${systemctl_bin} disable *"
  "${systemctl_bin} cat *"
  "${journalctl_bin} -u *"
  "${journalctl_bin} -k *"
  "${journalctl_bin} --disk-usage"
)

if [[ -n "${ss_bin}" ]]; then
  allowed_commands+=("${ss_bin} *")
fi
if [[ -n "${lsof_bin}" ]]; then
  allowed_commands+=("${lsof_bin} *")
fi
if [[ -n "${timedatectl_bin}" ]]; then
  allowed_commands+=("${timedatectl_bin} *")
fi
if [[ -n "${nginx_bin}" ]]; then
  allowed_commands+=("${nginx_bin} -t" "${nginx_bin} -T" "${nginx_bin} -s reload")
fi
if [[ -n "${ufw_bin}" ]]; then
  allowed_commands+=("${ufw_bin} status*" "${ufw_bin} allow *" "${ufw_bin} deny *" "${ufw_bin} delete *" "${ufw_bin} reload")
fi
if [[ -n "${firewall_cmd_bin}" ]]; then
  allowed_commands+=("${firewall_cmd_bin} --list-all" "${firewall_cmd_bin} --get-active-zones" "${firewall_cmd_bin} --reload" "${firewall_cmd_bin} --add-port=*"
    "${firewall_cmd_bin} --remove-port=*")
fi
if [[ -n "${iptables_bin}" ]]; then
  allowed_commands+=("${iptables_bin} -L *" "${iptables_bin} -S *")
fi
if [[ -n "${docker_bin}" ]]; then
  allowed_commands+=(
    "${docker_bin} ps"
    "${docker_bin} ps *"
    "${docker_bin} images"
    "${docker_bin} images *"
    "${docker_bin} logs *"
    "${docker_bin} inspect *"
    "${docker_bin} stats"
    "${docker_bin} stats *"
    "${docker_bin} info"
    "${docker_bin} version"
    "${docker_bin} compose version"
  )
fi

{
  echo "Defaults:${PTY_USER} !requiretty"
  printf '%s ALL=(root) NOPASSWD: ' "${PTY_USER}"
  first=1
  for cmd in "${allowed_commands[@]}"; do
    if [[ ${first} -eq 0 ]]; then
      printf ', '
    fi
    printf '%s' "${cmd}"
    first=0
  done
  printf '\n'
} >"${SUDOERS_FILE}"

chmod 0440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}"

if [[ -d "${APP_DIR}/.secrets" ]]; then
  chown -R root:root "${APP_DIR}/.secrets"
  find "${APP_DIR}/.secrets" -type d -exec chmod 0700 {} \;
  find "${APP_DIR}/.secrets" -type f -exec chmod 0600 {} \;
fi

echo "[privilege-mode] pty user: ${PTY_USER}"
echo "[privilege-mode] env file: ${ENV_FILE}"
echo "[privilege-mode] sudoers file: ${SUDOERS_FILE}"
