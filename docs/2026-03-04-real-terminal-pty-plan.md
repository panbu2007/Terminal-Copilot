# Real Terminal (PTY) Integration — Iteration Plan

**Date:** 2026-03-04
**Prerequisite:** DAG visualization verified complete

---

## 1. Problem Statement

### 1.1 Current Architecture (Fake Terminal)

```
User types in xterm.js
    → HTTP POST /api/execute { command: "ls -la" }
    → subprocess.Popen("ls -la", shell=True)
    → Returns { stdout, stderr, exit_code }
    → Renders output in xterm.js
```

Each command spawns an independent subprocess. No persistent shell state.

### 1.2 Specific Failures

| Issue | Example | Impact |
|-------|---------|--------|
| **No environment persistence** | `export FOO=bar` then `echo $FOO` → empty | Basic shell workflows broken |
| **cd is faked** | Python-level `_handle_cd()` simulation | Edge cases fail (cd with env vars, cd -) |
| **No PTY** | `vim`, `top`, `htop` → hang or crash | Interactive commands impossible |
| **No shell features** | pipes, redirects, aliases, functions | All work via subprocess but lose state |
| **No prompt** | Simulated `>` prompt, not real bash prompt | Looks artificial to judges |
| **Single-shot context** | LLM only sees last command's output | Cannot reference earlier session context |

### 1.3 Judge Risk

When a judge types `ls` and sees real output, then types `export PATH=$PATH:/opt/bin` and sees it forgotten — the credibility of the entire product collapses. The "enterprise SOP execution platform" story requires a real terminal foundation.

---

## 2. Architecture Design

### 2.1 Target Architecture

```
xterm.js ←→ WebSocket (binary frames) ←→ PTY (bash)
                                              │
              AI Sidecar Layer ←── reads ──── output stream
                     │
              CommandDetector (heuristic prompt detection)
                     │
              ConversationHistory (sliding window)
                     │
              Multi-Agent Orchestrator (existing)
                     │
              Suggestions → right panel (existing UI)
```

The terminal becomes a real bash session. AI acts as an observer — reading the terminal output stream and proactively generating suggestions in the side panel. Two modes coexist:

| Mode | Trigger | Flow |
|------|---------|------|
| **Free Terminal** | User types directly in terminal | Real bash execution; AI observes and suggests in side panel |
| **Plan Mode** | User clicks "Generate Plan" or types `?intent` | Existing DAG flow: plan → review → execute → audit |

### 2.2 Component Overview

```
backend/
├── app/
│   ├── pty_manager.py       # NEW: PTY session lifecycle
│   ├── ws_terminal.py       # NEW: WebSocket endpoint
│   ├── command_detector.py  # NEW: Detect command boundaries in PTY stream
│   ├── conversation.py      # NEW: Sliding-window conversation history
│   ├── main.py              # MODIFY: Add WebSocket route + mode switching
│   └── agents/
│       └── orchestrator.py  # MODIFY: Accept conversation history
│
frontend/
├── index.html               # MODIFY: Add mode toggle UI
└── static/
    └── app.js               # MODIFY: WebSocket connection + mode switching
```

---

## 3. Backend Implementation

### 3.1 PTY Session Manager

```python
# backend/app/pty_manager.py

import fcntl
import logging
import os
import pty
import select
import signal
import struct
import termios
import time
import threading
from dataclasses import dataclass, field

logger = logging.getLogger("terminal_copilot.pty")

@dataclass
class PTYSession:
    session_id: str
    pid: int = -1
    master_fd: int = -1
    alive: bool = False
    cwd: str = "/work"
    created_at: float = field(default_factory=time.time)

    # AI sidecar: ring buffer of recent output for context
    _output_lock: threading.Lock = field(default_factory=threading.Lock)
    _output_buffer: list[str] = field(default_factory=list)
    _max_buffer_chars: int = 50_000

    def get_recent_output(self, chars: int = 8000) -> str:
        with self._output_lock:
            total = "".join(self._output_buffer)
            return total[-chars:] if len(total) > chars else total

    def append_output(self, text: str):
        with self._output_lock:
            self._output_buffer.append(text)
            total = "".join(self._output_buffer)
            if len(total) > self._max_buffer_chars:
                self._output_buffer = [total[-self._max_buffer_chars:]]


_SESSIONS: dict[str, PTYSession] = {}
_LOCK = threading.Lock()


def create_pty_session(session_id: str, cwd: str = "/work") -> PTYSession:
    """Fork a real bash process with PTY."""
    master_fd, slave_fd = pty.openpty()

    pid = os.fork()
    if pid == 0:
        # ── Child process: become bash ──
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)

        # Set working directory
        try:
            os.chdir(cwd)
        except Exception:
            os.chdir("/")

        # Clean environment
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["LANG"] = "en_US.UTF-8"

        os.execvpe("bash", ["bash", "--login"], env)
        # execvpe never returns

    # ── Parent process ──
    os.close(slave_fd)

    session = PTYSession(
        session_id=session_id,
        pid=pid,
        master_fd=master_fd,
        alive=True,
        cwd=cwd,
    )

    with _LOCK:
        # Clean up stale session if exists
        old = _SESSIONS.pop(session_id, None)
        if old and old.alive:
            _destroy_session(old)
        _SESSIONS[session_id] = session

    logger.info("PTY session created: sid=%s pid=%d fd=%d", session_id, pid, master_fd)
    return session


def get_pty_session(session_id: str) -> PTYSession | None:
    with _LOCK:
        return _SESSIONS.get(session_id)


def destroy_pty_session(session_id: str):
    with _LOCK:
        session = _SESSIONS.pop(session_id, None)
    if session:
        _destroy_session(session)


def _destroy_session(session: PTYSession):
    session.alive = False
    try:
        os.close(session.master_fd)
    except Exception:
        pass
    try:
        os.kill(session.pid, signal.SIGTERM)
        # Give it 1 second, then force kill
        threading.Timer(1.0, lambda: _force_kill(session.pid)).start()
    except Exception:
        pass


def _force_kill(pid: int):
    try:
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


def pty_write(session: PTYSession, data: bytes):
    """Send raw bytes to the PTY (user keystrokes)."""
    if not session.alive:
        return
    try:
        os.write(session.master_fd, data)
    except OSError:
        session.alive = False


def pty_read(session: PTYSession, timeout: float = 0.05) -> bytes:
    """Non-blocking read from PTY."""
    if not session.alive:
        return b""
    try:
        rlist, _, _ = select.select([session.master_fd], [], [], timeout)
        if rlist:
            data = os.read(session.master_fd, 8192)
            if data:
                session.append_output(data.decode("utf-8", errors="replace"))
                return data
            else:
                session.alive = False
    except OSError:
        session.alive = False
    return b""


def pty_resize(session: PTYSession, rows: int, cols: int):
    """Notify PTY of terminal size change."""
    if not session.alive:
        return
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(session.master_fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        pass
```

### 3.2 WebSocket Terminal Endpoint

```python
# backend/app/ws_terminal.py

import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from .pty_manager import (
    create_pty_session,
    destroy_pty_session,
    get_pty_session,
    pty_read,
    pty_resize,
    pty_write,
)
from .command_detector import CommandDetector
from .conversation import ConversationHistory

logger = logging.getLogger("terminal_copilot.ws")


async def handle_terminal_ws(ws: WebSocket, session_id: str, cwd: str = "/work"):
    """Full-duplex WebSocket ↔ PTY bridge with AI sidecar."""
    await ws.accept()

    # Get or create PTY session
    session = get_pty_session(session_id)
    if session is None or not session.alive:
        session = create_pty_session(session_id, cwd=cwd)

    detector = CommandDetector()
    conversation = ConversationHistory(max_tokens=6000)

    # Background task: read PTY output → send to WebSocket
    async def pty_reader():
        loop = asyncio.get_event_loop()
        while session.alive:
            data = await loop.run_in_executor(None, pty_read, session, 0.03)
            if data:
                try:
                    await ws.send_bytes(data)
                except Exception:
                    break

                # Feed to command detector for AI context
                text = data.decode("utf-8", errors="replace")
                events = detector.feed(text)
                for event in events:
                    if event["type"] == "command_complete":
                        conversation.add_command(event.get("command", ""))
                        conversation.add_output(event.get("output", ""))
            else:
                await asyncio.sleep(0.015)

    reader_task = asyncio.create_task(pty_reader())

    try:
        while True:
            msg = await ws.receive()

            if "bytes" in msg:
                # Raw terminal input → PTY
                pty_write(session, msg["bytes"])

            elif "text" in msg:
                # JSON control messages
                try:
                    ctrl = json.loads(msg["text"])
                except Exception:
                    continue

                msg_type = ctrl.get("type", "")

                if msg_type == "resize":
                    rows = int(ctrl.get("rows", 24))
                    cols = int(ctrl.get("cols", 80))
                    pty_resize(session, rows, cols)

                elif msg_type == "ai_context":
                    # Frontend requests current AI context
                    # (for passing to /api/suggest or /api/plan/generate)
                    context = {
                        "recent_output": session.get_recent_output(4000),
                        "conversation": conversation.to_summary(),
                    }
                    await ws.send_text(json.dumps({
                        "type": "ai_context",
                        "data": context,
                    }))

                elif msg_type == "ai_suggest":
                    # Trigger AI suggestion with conversation context
                    intent = ctrl.get("intent", "")
                    conversation.add_intent(intent)
                    await ws.send_text(json.dumps({
                        "type": "ai_suggest_ack",
                        "conversation_messages": conversation.to_llm_messages()[-10:],
                    }))

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", session_id)
    except Exception as e:
        logger.warning("WebSocket error: %s", e)
    finally:
        reader_task.cancel()
        try:
            await reader_task
        except asyncio.CancelledError:
            pass
        # Note: don't destroy PTY session on disconnect — allow reconnection
```

### 3.3 Command Boundary Detector

```python
# backend/app/command_detector.py

import re
from dataclasses import dataclass, field


@dataclass
class CommandDetector:
    """Heuristic detection of command boundaries in PTY output stream.

    Strategy:
    - Detect shell prompt patterns ($ # > %%)
    - When a new prompt appears, the text between previous prompt and current
      prompt is the output of the last command
    - Extract the command text from the prompt line
    """

    buffer: str = ""
    last_prompt_end: int = 0
    last_command: str = ""
    _prompt_re: re.Pattern = field(
        default_factory=lambda: re.compile(
            r"(?:"
            r"(?:[\w@.\-]+[:\s])?[\w~/.\-]*[$#%>]\s*$"  # user@host:~$
            r"|"
            r"\([\w\-]+\)\s*[\w@.\-]*[$#%>]\s*$"         # (venv) user$
            r"|"
            r"bash-[\d.]+[$#]\s*$"                         # bash-5.1$
            r")",
            re.MULTILINE,
        )
    )

    def feed(self, data: str) -> list[dict]:
        """Feed new PTY output data. Returns detected command-complete events."""
        self.buffer += data
        events = []

        # Look for prompt patterns in the buffer
        lines = self.buffer.split("\n")

        for i, line in enumerate(lines):
            stripped = line.rstrip("\r\n \t")
            if not stripped:
                continue

            match = self._prompt_re.search(stripped)
            if match is None:
                continue

            # Found a prompt line — everything before it (since last prompt) is output
            if self.last_prompt_end > 0:
                output_lines = lines[self.last_prompt_end:i]
                output_text = "\n".join(output_lines).strip()

                # The first line after previous prompt was the command
                command = ""
                if output_lines:
                    first_line = output_lines[0].strip()
                    # Strip common prompt prefixes
                    for prefix_pat in [r"^.*[$#%>]\s*", r"^\([\w\-]+\)\s*.*[$#%>]\s*"]:
                        cleaned = re.sub(prefix_pat, "", first_line).strip()
                        if cleaned:
                            command = cleaned
                            break
                    if not command:
                        command = first_line

                    # Output is everything after the command line
                    output_text = "\n".join(output_lines[1:]).strip()

                if command or output_text:
                    events.append({
                        "type": "command_complete",
                        "command": command,
                        "output": output_text[:5000],  # Cap output size
                    })

            self.last_prompt_end = i + 1

        # Keep only unprocessed buffer tail (from last detected prompt onward)
        if self.last_prompt_end > 0 and self.last_prompt_end < len(lines):
            self.buffer = "\n".join(lines[self.last_prompt_end:])
            self.last_prompt_end = 0
        elif self.last_prompt_end >= len(lines):
            self.buffer = ""
            self.last_prompt_end = 0

        # Prevent buffer from growing unbounded
        if len(self.buffer) > 20000:
            self.buffer = self.buffer[-15000:]

        return events
```

### 3.4 Conversation History (Long Context for LLM)

```python
# backend/app/conversation.py

import time
from dataclasses import dataclass, field


@dataclass
class ConversationTurn:
    role: str       # "command" | "output" | "intent" | "suggestion"
    content: str
    timestamp: float = field(default_factory=time.time)


class ConversationHistory:
    """Sliding-window conversation history for multi-turn LLM context."""

    def __init__(self, max_tokens: int = 6000):
        self.turns: list[ConversationTurn] = []
        self.max_tokens = max_tokens

    def add_command(self, command: str):
        if not command.strip():
            return
        self.turns.append(ConversationTurn("command", command.strip()))
        self._trim()

    def add_output(self, output: str):
        if not output.strip():
            return
        # Truncate very long outputs, keep head + tail
        text = output.strip()
        if len(text) > 2000:
            text = text[:1000] + "\n... (truncated) ...\n" + text[-800:]
        self.turns.append(ConversationTurn("output", text))
        self._trim()

    def add_intent(self, intent: str):
        if not intent.strip():
            return
        self.turns.append(ConversationTurn("intent", intent.strip()))
        self._trim()

    def add_suggestion(self, suggestion: str):
        if not suggestion.strip():
            return
        self.turns.append(ConversationTurn("suggestion", suggestion.strip()))
        self._trim()

    def to_llm_messages(self) -> list[dict[str, str]]:
        """Convert to LLM messages format for multi-turn conversation."""
        messages = []
        for turn in self.turns:
            if turn.role == "command":
                messages.append({
                    "role": "user",
                    "content": f"[执行命令] $ {turn.content}",
                })
            elif turn.role == "output":
                messages.append({
                    "role": "user",
                    "content": f"[终端输出]\n{turn.content}",
                })
            elif turn.role == "intent":
                messages.append({
                    "role": "user",
                    "content": f"[用户问题] {turn.content}",
                })
            elif turn.role == "suggestion":
                messages.append({
                    "role": "assistant",
                    "content": turn.content,
                })
        return messages

    def to_summary(self) -> str:
        """Compact text summary for API responses."""
        lines = []
        for turn in self.turns[-10:]:
            if turn.role == "command":
                lines.append(f"$ {turn.content}")
            elif turn.role == "output":
                lines.append(turn.content[:200])
            elif turn.role == "intent":
                lines.append(f"? {turn.content}")
        return "\n".join(lines)

    def _trim(self):
        """Keep within token budget (rough estimate: 1 CJK char ≈ 0.6 tokens)."""
        while self._estimate_tokens() > self.max_tokens and len(self.turns) > 2:
            self.turns.pop(0)

    def _estimate_tokens(self) -> int:
        total_chars = sum(len(t.content) for t in self.turns)
        return int(total_chars * 0.6)

    def clear(self):
        self.turns.clear()
```

### 3.5 Main.py Integration

```python
# Add to backend/app/main.py

from .ws_terminal import handle_terminal_ws

@app.websocket("/ws/terminal/{session_id}")
async def ws_terminal(ws: WebSocket, session_id: str):
    """WebSocket endpoint for real PTY terminal."""
    session = STORE.get_or_create(None if session_id == "new" else session_id)
    local_root = Path(os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))).resolve()
    cwd = session.cwd or str(local_root)
    await handle_terminal_ws(ws, str(session.id), cwd=cwd)
```

---

## 4. Frontend Implementation

### 4.1 Mode Toggle UI

Add to header bar:

```html
<!-- In index.html header -->
<div class="segmented" id="terminalModeSwitch" aria-label="终端模式切换">
  <button class="seg-btn is-active" data-term-mode="pty" type="button">🖥️ 真实终端</button>
  <button class="seg-btn" data-term-mode="plan" type="button">📋 计划模式</button>
</div>
```

### 4.2 WebSocket Terminal Connection

```javascript
// Add to app.js

let ptyWebSocket = null;
let terminalMode = 'pty'; // 'pty' | 'plan'

function connectPTY(sessionId) {
    if (ptyWebSocket) {
        ptyWebSocket.close();
        ptyWebSocket = null;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws/terminal/${sessionId}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        statusEl.textContent = '真实终端已连接';
        // Send initial terminal size
        ws.send(JSON.stringify({
            type: 'resize',
            rows: term.rows,
            cols: term.cols,
        }));
    };

    ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
            // Binary: PTY output → render in xterm
            term.write(new Uint8Array(event.data));
        } else {
            // Text: JSON control messages from server
            try {
                const msg = JSON.parse(event.data);
                handleServerMessage(msg);
            } catch {}
        }
    };

    ws.onclose = () => {
        statusEl.textContent = '终端连接断开';
        ptyWebSocket = null;
    };

    ws.onerror = () => {
        statusEl.textContent = '终端连接错误';
    };

    ptyWebSocket = ws;
    return ws;
}

function handleServerMessage(msg) {
    if (msg.type === 'ai_context') {
        // Server returned conversation context for AI
        // Use this when generating suggestions
    }
    if (msg.type === 'ai_suggest_ack') {
        // Server acknowledged AI suggestion request
        // Trigger /api/suggest with conversation context
    }
}

// In PTY mode: user keystrokes go directly to WebSocket
function setupPTYMode() {
    // Detach old onData handler
    if (termDataDisposable) termDataDisposable.dispose();

    termDataDisposable = term.onData((data) => {
        if (ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
            ptyWebSocket.send(new TextEncoder().encode(data));
        }
    });

    // Resize events
    term.onResize(({ rows, cols }) => {
        if (ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
            ptyWebSocket.send(JSON.stringify({ type: 'resize', rows, cols }));
        }
    });
}

// Switch between PTY and Plan modes
function setTerminalMode(mode) {
    terminalMode = mode;

    if (mode === 'pty') {
        setupPTYMode();
        const sid = getSessionId() || 'new';
        connectPTY(sid);
    } else {
        // Plan mode: disconnect PTY, use existing HTTP-based terminal
        if (ptyWebSocket) {
            ptyWebSocket.close();
            ptyWebSocket = null;
        }
        setupPlanMode(); // Restore the original onData handler
    }

    // Update toggle buttons
    document.querySelectorAll('#terminalModeSwitch .seg-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.termMode === mode);
    });
}
```

### 4.3 AI Sidecar in PTY Mode

In PTY mode, AI suggestions are triggered differently — not on every Enter, but on explicit request or on detected command failure:

```javascript
// AI suggestion trigger in PTY mode
// Option 1: User presses a hotkey (e.g., Ctrl+Space)
// Option 2: User types "?" prefix in a special input
// Option 3: Auto-detect command failure and suggest

// Add a small "Ask AI" button near the terminal
// or a hotkey hint: "Press Ctrl+Space for AI assistance"

function requestAISuggestion(intent) {
    if (ptyWebSocket && ptyWebSocket.readyState === WebSocket.OPEN) {
        // Ask server for current conversation context
        ptyWebSocket.send(JSON.stringify({
            type: 'ai_suggest',
            intent: intent || '',
        }));
    }

    // Then call existing /api/suggest/stream with conversation context
    // The SSE stream will push agent progress and suggestions to the right panel
}
```

---

## 5. Two Modes Coexistence

```
┌─────────────────────────────────────────────────────┐
│  [🖥️ 真实终端]  [📋 计划模式]                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  PTY Mode:                                          │
│  - Real bash via WebSocket                          │
│  - Full shell state (env vars, cd, pipes, aliases)  │
│  - Interactive commands (vim, top) work              │
│  - AI observes output stream, suggests in sidebar   │
│  - Press Ctrl+Space or click "Ask AI" for help      │
│  - Conversation history enables multi-turn context  │
│                                                     │
│  Plan Mode:                                         │
│  - Existing HTTP-based command execution             │
│  - DAG plan generation and visualization            │
│  - Step-by-step execution with approval gates       │
│  - Automatic audit reports                          │
│  - Best for SOP workflows and training              │
│                                                     │
│  Hybrid:                                            │
│  - Start in PTY mode, encounter an error            │
│  - Switch to Plan mode: "fix this error"            │
│  - AI generates repair plan with full context       │
│  - Execute plan, verify, switch back to PTY         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 6. Long Conversation Integration

### 6.1 How Conversation Flows into LLM

```
User in PTY types: pip install flask
PTY output: Successfully installed flask-3.0.0
    → CommandDetector detects prompt reappear
    → ConversationHistory.add_command("pip install flask")
    → ConversationHistory.add_output("Successfully installed flask-3.0.0")

User types: python app.py
PTY output: ModuleNotFoundError: No module named 'sqlalchemy'
    → ConversationHistory.add_command("python app.py")
    → ConversationHistory.add_output("ModuleNotFoundError: ...")

User presses Ctrl+Space (Ask AI)
    → Frontend calls /api/suggest/stream with conversation history
    → LLM sees full context:
        [执行命令] $ pip install flask
        [终端输出] Successfully installed flask-3.0.0
        [执行命令] $ python app.py
        [终端输出] ModuleNotFoundError: No module named 'sqlalchemy'
        [用户问题] (auto: command failed, suggest fix)
    → LLM knows flask was just installed, app.py needs sqlalchemy
    → Suggests: pip install sqlalchemy
```

### 6.2 Modify Orchestrator for Conversation Context

```python
# In agents/orchestrator.py

class OrchestratorAgent:
    def process(
        self,
        *,
        user_intent: str,
        platform: str | None,
        last_stdout: str = "",
        last_stderr: str = "",
        last_exit_code: int | None = None,
        event_queue: Queue | None = None,
        conversation_messages: list[dict] | None = None,  # NEW
    ) -> list[CommandSuggestion]:

        # Pass conversation context to ExecutorAgent
        raw_suggestions = _executor.generate(
            user_intent=user_intent,
            platform=platform,
            diag=diag_result,
            citations=rag_citations,
            last_stdout=last_stdout,
            last_stderr=last_stderr,
            event_queue=event_queue,
            conversation_messages=conversation_messages,  # NEW
        )
```

### 6.3 Modify suggest/stream Endpoint

```python
# In main.py - modify api_suggest_stream

class SuggestRequest(BaseModel):
    # ... existing fields ...
    conversation_messages: list[dict] | None = None  # NEW: optional multi-turn context
```

---

## 7. Platform Compatibility

### 7.1 Linux / Docker (Primary Target)

PTY works natively. `pty.openpty()` + `os.fork()` + `os.execvpe("bash", ...)` is standard POSIX.

The Docker container already runs Linux with bash. This is the primary deployment environment (ModelScope Spaces).

### 7.2 Windows Development

`pty.openpty()` does not exist on Windows. Two options:

**Option A (Recommended): Use winpty / ConPTY via pywinpty**

```python
# Windows-compatible PTY using pywinpty
try:
    import pty  # Unix
    USE_NATIVE_PTY = True
except ImportError:
    USE_NATIVE_PTY = False

if not USE_NATIVE_PTY:
    try:
        from winpty import PtyProcess  # pip install pywinpty
        USE_WINPTY = True
    except ImportError:
        USE_WINPTY = False
```

**Option B: PTY only in Docker/Linux, subprocess fallback on Windows**

```python
def create_pty_session(session_id, cwd):
    if os.name == "nt":
        # Windows: fall back to existing subprocess executor
        return None  # Signals frontend to use HTTP mode
    # Linux: real PTY
    ...
```

For the hackathon, Option B is sufficient — the demo runs in Docker (Linux).

### 7.3 Dependency

Add to `backend/requirements.txt`:

```
# No new dependencies for Linux PTY (stdlib: pty, select, fcntl, termios)
# Optional for Windows dev:
# pywinpty>=2.0; sys_platform == "win32"
```

---

## 8. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| PTY allows arbitrary commands | Same as giving someone SSH access — expected for terminal tool |
| AI suggestions bypass safety | AI suggestions still go through SafetyAgent. PTY direct input is user's responsibility. |
| WebSocket hijacking | Same-origin policy. Add session token validation if needed. |
| Resource exhaustion | Limit PTY sessions per server. Auto-cleanup idle sessions (30 min timeout). |
| Docker escape | PTY runs inside container — same isolation as existing subprocess executor |

```python
# Session cleanup: add to main.py startup

@app.on_event("startup")
def _pty_cleanup_task():
    """Periodically clean up idle PTY sessions."""
    import threading

    def cleanup():
        while True:
            time.sleep(300)  # Every 5 minutes
            now = time.time()
            with _LOCK:
                stale = [
                    sid for sid, s in _SESSIONS.items()
                    if now - s.created_at > 1800  # 30 min idle
                ]
            for sid in stale:
                destroy_pty_session(sid)

    t = threading.Thread(target=cleanup, daemon=True)
    t.start()
```

---

## 9. Schedule

| Day | Task | Output |
|-----|------|--------|
| **Day 1** | `pty_manager.py` + `ws_terminal.py` + WebSocket route in main.py | Backend: PTY creation + WebSocket bridge working |
| **Day 2** | Frontend: `connectPTY()` + mode toggle + xterm.js WebSocket binding | Full PTY terminal working in browser |
| **Day 3** | `command_detector.py` + `conversation.py` + AI sidecar integration | AI sees conversation history, suggests with context |
| **Day 3.5** | Testing: interactive commands (vim, top), env persistence, edge cases | Verified real terminal behavior |

### Minimum Viable (2 days)

Day 1: PTY backend + WebSocket endpoint
Day 2: Frontend WebSocket connection + mode toggle

This alone gives a real terminal. The AI sidecar (conversation history) can be added incrementally.

---

## 10. Impact Assessment

| Dimension | Before (subprocess) | After (PTY) | Delta |
|-----------|--------------------|--------------------|-------|
| Scene Value | "Simulated terminal" — loses credibility | "Real terminal with AI sidecar" — enterprise-ready | +2-3 |
| User Experience | Feels fake, no shell state | Indistinguishable from real terminal | +2-3 |
| Track-Specific | "How to use in real environment?" | "This IS a real environment" | +2-3 |
| Visitor Vote | Visitors confused by fake outputs | Type `ls`, see real files — instant understanding | +2-3 |
| Technical Foresight | Standard subprocess | WebSocket PTY + AI observer pattern | +1 |

**Total estimated impact: +8-12 points across all dimensions.**
