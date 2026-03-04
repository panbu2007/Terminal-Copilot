from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

from fastapi import WebSocket, WebSocketDisconnect

from .pty_manager import (
    create_pty_session,
    get_pty_session,
    get_pty_working_directory,
    pty_read,
    pty_resize,
    pty_supported,
    pty_write,
)
from .store import STORE


logger = logging.getLogger("terminal_copilot.ws")


async def handle_terminal_ws(ws: WebSocket, session_id: str, cwd: str) -> None:
    await ws.accept()

    if not pty_supported():
        await ws.send_text(
            json.dumps(
                {
                    "type": "terminal_status",
                    "status": "unsupported",
                    "reason": "pty_not_supported_on_host",
                }
            )
        )
        await ws.close()
        return

    session = get_pty_session(session_id)
    if session is None or not session.alive:
        session = create_pty_session(session_id, cwd=cwd)

    async def reader_loop() -> None:
        loop = asyncio.get_running_loop()
        while session.alive:
            data = await loop.run_in_executor(None, pty_read, session, 0.05)
            if not data:
                await asyncio.sleep(0.02)
                continue
            text = data.decode("utf-8", errors="replace")
            events = session.detector.feed_output(text)
            for event in events:
                if event.get("type") == "command_complete":
                    session.conversation.add_command(str(event.get("command") or ""))
                    session.conversation.add_output(str(event.get("output") or ""))
            await ws.send_bytes(data)

    reader_task = asyncio.create_task(reader_loop())

    try:
        while True:
            message = await ws.receive()

            if "bytes" in message and message["bytes"] is not None:
                try:
                    session.detector.feed_input(message["bytes"].decode("utf-8", errors="ignore"))
                except Exception:
                    pass
                pty_write(session, message["bytes"])
                continue

            text = message.get("text")
            if not text:
                continue

            try:
                payload = json.loads(text)
            except Exception:
                continue

            msg_type = str(payload.get("type") or "").strip().lower()
            if msg_type == "resize":
                rows = max(2, int(payload.get("rows") or 24))
                cols = max(8, int(payload.get("cols") or 80))
                pty_resize(session, rows, cols)
            elif msg_type == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
            elif msg_type == "ai_context":
                request_id = str(payload.get("request_id") or "")
                cwd_value = get_pty_working_directory(session)
                try:
                    store_session = STORE.get(UUID(session_id))
                    if store_session is not None:
                        store_session.cwd = cwd_value
                except Exception:
                    pass
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "ai_context",
                            "request_id": request_id,
                            "data": {
                                "recent_output": session.get_recent_output(4000),
                                "conversation_summary": session.conversation.to_summary(),
                                "conversation_messages": session.conversation.to_llm_messages(),
                                "cwd": cwd_value,
                            },
                        },
                        ensure_ascii=False,
                    )
                )
            elif msg_type == "ai_suggest":
                request_id = str(payload.get("request_id") or "")
                intent = str(payload.get("intent") or "").strip()
                session.conversation.add_intent(intent)
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "ai_suggest_ack",
                            "request_id": request_id,
                            "data": {
                                "conversation_messages": session.conversation.to_llm_messages(),
                            },
                        },
                        ensure_ascii=False,
                    )
                )
    except WebSocketDisconnect:
        logger.info("terminal websocket disconnected sid=%s", session_id)
    except Exception:
        logger.exception("terminal websocket failed sid=%s", session_id)
    finally:
        reader_task.cancel()
        try:
            await reader_task
        except asyncio.CancelledError:
            pass
