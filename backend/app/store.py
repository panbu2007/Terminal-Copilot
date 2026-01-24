from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4


@dataclass
class Step:
    id: str
    title: str
    command: str
    status: str  # planned | running | success | failed
    detail: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))


@dataclass
class Session:
    id: UUID
    created_at: datetime = field(default_factory=lambda: datetime.now(tz=timezone.utc))
    steps: list[Step] = field(default_factory=list)
    events: list[dict[str, str]] = field(default_factory=list)
    cwd: str = ""


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[UUID, Session] = {}

    def get_or_create(self, session_id: UUID | None) -> Session:
        if session_id is not None and session_id in self._sessions:
            return self._sessions[session_id]
        new_session = Session(id=uuid4())
        self._sessions[new_session.id] = new_session
        return new_session

    def get(self, session_id: UUID) -> Session | None:
        return self._sessions.get(session_id)

    def add_planned_steps(self, session: Session, *, items: list[tuple[str, str]]) -> None:
        """Add planned steps by (title, command), de-duplicated by command."""
        existing_commands = {s.command for s in session.steps}
        for title, command in items:
            if not command or command in existing_commands:
                continue
            session.steps.append(
                Step(
                    id=str(uuid4()),
                    title=title,
                    command=command,
                    status="planned",
                )
            )
            existing_commands.add(command)

    def add_execution_step(self, session: Session, *, command: str, exit_code: int) -> None:
        session.steps.append(
            Step(
                id=str(uuid4()),
                title="执行命令",
                command=command,
                status="success" if exit_code == 0 else "failed",
            )
        )

    def add_verification_step(self, session: Session, *, title: str, command: str, ok: bool, detail: str) -> None:
        session.steps.append(
            Step(
                id=str(uuid4()),
                title=title,
                command=command,
                status="success" if ok else "failed",
                detail=detail,
            )
        )

    def to_dict_steps(self, session: Session) -> list[dict[str, str]]:
        return [
            {
                "id": s.id,
                "title": s.title,
                "command": s.command,
                "status": s.status,
                "created_at": s.created_at.isoformat(),
                "detail": s.detail,
            }
            for s in session.steps
        ]

    def add_event(self, session: Session, *, kind: str, payload: dict[str, str]) -> None:
        session.events.append(
            {
                "ts": datetime.now(tz=timezone.utc).isoformat(),
                "kind": kind,
                **payload,
            }
        )

    def to_dict_events(self, session: Session) -> list[dict[str, str]]:
        return list(session.events)


STORE = SessionStore()
