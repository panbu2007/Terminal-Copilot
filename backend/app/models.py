from __future__ import annotations

from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    safe = "safe"
    warn = "warn"
    block = "block"


class Citation(BaseModel):
    title: str
    snippet: str


class CommandSuggestion(BaseModel):
    id: str
    title: str
    command: str
    explanation: str
    agent: str = ""
    why: str = ""
    risk: str = ""
    rollback: str = ""
    verify: str = ""
    risk_level: RiskLevel = RiskLevel.safe
    requires_confirmation: bool = False
    tags: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)


class SuggestRequest(BaseModel):
    session_id: UUID | None = None
    last_command: str = ""
    last_exit_code: int | None = None
    last_stdout: str = ""
    last_stderr: str = ""
    platform: Literal["windows", "linux", "mac"] | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class SuggestResponse(BaseModel):
    session_id: UUID
    suggestions: list[CommandSuggestion]
    steps: list["StepModel"] = Field(default_factory=list)


class StepModel(BaseModel):
    id: str
    title: str
    command: str
    status: str
    created_at: str
    detail: str = ""


class ExecuteRequest(BaseModel):
    session_id: UUID | None = None
    command: str
    confirmed: bool = False


class ExecuteResponse(BaseModel):
    session_id: UUID
    command: str
    exit_code: int
    stdout: str
    stderr: str
    executor: str
    steps: list[StepModel] = Field(default_factory=list)


class InterruptRequest(BaseModel):
    session_id: UUID


class InterruptResponse(BaseModel):
    ok: bool
    message: str = ""


class SessionResponse(BaseModel):
    session_id: UUID
    created_at: str
    steps: list[StepModel] = Field(default_factory=list)


class EventsResponse(BaseModel):
    session_id: UUID
    events: list[dict[str, str]] = Field(default_factory=list)


class ExportResponse(BaseModel):
    session_id: UUID
    created_at: str
    steps: list[StepModel] = Field(default_factory=list)
    events: list[dict[str, str]] = Field(default_factory=list)


class LlmTokenRequest(BaseModel):
    token: str


class LlmConfigRequest(BaseModel):
    token: str | None = None
    model: str | None = None


class LlmStatusResponse(BaseModel):
    enabled: bool
    has_token: bool
    provider: str
    base_url: str
    model: str


class LlmTestRequest(BaseModel):
    token: str | None = None
    model: str | None = None
    prompt: str | None = None


class LlmTestResponse(BaseModel):
    ok: bool
    provider: str
    base_url: str
    model: str
    latency_ms: int
    message: str
    preview: str = ""


ExecutorMode = Literal["simulate", "local"]


class ExecutorModeRequest(BaseModel):
    mode: ExecutorMode


class ExecutorStatusResponse(BaseModel):
    mode: ExecutorMode
    available: list[ExecutorMode]
    allow_local: bool
