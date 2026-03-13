from __future__ import annotations

import os
import select
import signal
import threading
import time
from dataclasses import dataclass, field
from typing import Any

try:
    import pwd
except ImportError:  # pragma: no cover - Windows dev fallback
    pwd = None

from .command_detector import CommandDetector
from .conversation import ConversationHistory

try:
    import fcntl
    import pty
    import struct
    import termios
except ImportError:  # pragma: no cover - Windows dev fallback
    fcntl = None
    pty = None
    struct = None
    termios = None


PTY_IDLE_TIMEOUT_SECONDS = 30 * 60


@dataclass
class PTYSession:
    session_id: str
    pid: int
    master_fd: int
    cwd: str
    created_at: float = field(default_factory=time.time)
    last_active_at: float = field(default_factory=time.time)
    alive: bool = True
    detector: CommandDetector = field(default_factory=CommandDetector)
    conversation: ConversationHistory = field(default_factory=ConversationHistory)
    _output_lock: threading.Lock = field(default_factory=threading.Lock)
    _output_buffer: list[str] = field(default_factory=list)
    _max_buffer_chars: int = 50000

    def touch(self) -> None:
        self.last_active_at = time.time()

    def append_output(self, text: str) -> None:
        value = str(text or "")
        if not value:
            return
        with self._output_lock:
            self._output_buffer.append(value)
            joined = "".join(self._output_buffer)
            if len(joined) > self._max_buffer_chars:
                self._output_buffer = [joined[-self._max_buffer_chars:]]

    def get_recent_output(self, chars: int = 8000) -> str:
        with self._output_lock:
            data = "".join(self._output_buffer)
        return data[-chars:] if len(data) > chars else data


_SESSIONS: dict[str, PTYSession] = {}
_LOCK = threading.Lock()


def pty_supported() -> bool:
    return os.name != "nt" and all(mod is not None for mod in (fcntl, pty, struct, termios))


def _pty_shell() -> str:
    return os.environ.get("TERMINAL_COPILOT_PTY_SHELL") or os.environ.get("SHELL") or "/bin/bash"


def _pty_drop_user() -> str:
    return (os.environ.get("TERMINAL_COPILOT_PTY_DROP_USER") or "").strip()


def _resolve_target_user() -> Any | None:
    drop_user = _pty_drop_user()
    if not drop_user or os.name == "nt" or pwd is None or os.geteuid() != 0:
        return None
    try:
        return pwd.getpwnam(drop_user)
    except KeyError:
        return None


def _drop_privileges(target_user: Any) -> None:
    os.initgroups(target_user.pw_name, target_user.pw_gid)
    os.setgid(target_user.pw_gid)
    os.setuid(target_user.pw_uid)


def _build_shell_env(target_user: Any | None) -> dict[str, str]:
    env = os.environ.copy()
    env["TERM"] = env.get("TERM") or "xterm-256color"
    env["LANG"] = env.get("LANG") or "en_US.UTF-8"
    if target_user is not None:
        env["HOME"] = target_user.pw_dir
        env["USER"] = target_user.pw_name
        env["LOGNAME"] = target_user.pw_name
    return env


def create_pty_session(session_id: str, cwd: str) -> PTYSession:
    if not pty_supported():
        raise RuntimeError("pty_not_supported")

    master_fd, slave_fd = pty.openpty()
    pid = os.fork()

    if pid == 0:  # pragma: no cover - exercised only in POSIX runtime
        try:
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)

            target_user = _resolve_target_user()
            shell = _pty_shell()
            env = _build_shell_env(target_user)

            if target_user is not None:
                try:
                    os.chdir(target_user.pw_dir)
                except Exception:
                    pass
                _drop_privileges(target_user)

            try:
                os.chdir(cwd)
            except Exception:
                os.chdir("/")

            os.execvpe(shell, [shell, "--login"], env)
        finally:
            os._exit(1)

    os.close(slave_fd)
    try:
        os.set_blocking(master_fd, False)
    except Exception:
        pass

    session = PTYSession(session_id=session_id, pid=pid, master_fd=master_fd, cwd=cwd)

    with _LOCK:
        old = _SESSIONS.pop(session_id, None)
        if old is not None:
            _destroy_session(old)
        _SESSIONS[session_id] = session

    return session


def get_pty_session(session_id: str) -> PTYSession | None:
    with _LOCK:
        session = _SESSIONS.get(session_id)
    if session is not None:
        session.touch()
    return session


def destroy_pty_session(session_id: str) -> None:
    with _LOCK:
        session = _SESSIONS.pop(session_id, None)
    if session is not None:
        _destroy_session(session)


def cleanup_idle_sessions(max_idle_seconds: int = PTY_IDLE_TIMEOUT_SECONDS) -> list[str]:
    now = time.time()
    stale_sessions: list[PTYSession] = []

    with _LOCK:
        for session_id, session in list(_SESSIONS.items()):
            if not session.alive or now - session.last_active_at > max_idle_seconds:
                stale_sessions.append(session)
                _SESSIONS.pop(session_id, None)

    for session in stale_sessions:
        _destroy_session(session)

    return [session.session_id for session in stale_sessions]


def pty_write(session: PTYSession, data: bytes) -> None:
    if not session.alive:
        return
    try:
        os.write(session.master_fd, data)
        session.touch()
    except OSError:
        session.alive = False


def pty_read(session: PTYSession, timeout: float = 0.05) -> bytes:
    if not session.alive:
        return b""

    try:
        ready, _, _ = select.select([session.master_fd], [], [], timeout)
        if not ready:
            return b""
        data = os.read(session.master_fd, 8192)
        if not data:
            session.alive = False
            return b""
        session.touch()
        session.append_output(data.decode("utf-8", errors="replace"))
        return data
    except OSError:
        session.alive = False
        return b""


def pty_resize(session: PTYSession, rows: int, cols: int) -> None:
    if not session.alive or not pty_supported():
        return
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(session.master_fd, termios.TIOCSWINSZ, winsize)
        session.touch()
    except Exception:
        pass


def get_pty_working_directory(session: PTYSession) -> str:
    if os.name == "nt":
        return session.cwd
    try:
        cwd = os.readlink(f"/proc/{session.pid}/cwd")
        if cwd:
            session.cwd = cwd
            return cwd
    except Exception:
        pass
    return session.cwd


def _destroy_session(session: PTYSession) -> None:
    session.alive = False
    try:
        os.close(session.master_fd)
    except Exception:
        pass
    try:
        os.kill(session.pid, signal.SIGTERM)
    except Exception:
        return
    threading.Timer(1.0, _force_kill, args=(session.pid,)).start()


def _force_kill(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass
