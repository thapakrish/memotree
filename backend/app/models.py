from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ImportSourcePlatform = Literal["chatgpt", "claude", "gemini", "other"]
InferenceConfidence = Literal["high", "medium", "low"]
ImportedRole = Literal["user", "assistant", "system"]


class ImportedTurn(BaseModel):
    sourceTurnId: str | None = None
    role: ImportedRole
    text: str = Field(min_length=1)
    timestamp: str | None = None


class SharedUrlImportRequest(BaseModel):
    url: str = Field(min_length=1)


class SharedUrlImportResponse(BaseModel):
    sourcePlatform: ImportSourcePlatform
    sourceConversationId: str | None = None
    turns: list[ImportedTurn]
    parserConfidence: InferenceConfidence
    parserName: str
    warnings: list[str] | None = None


class ErrorResponse(BaseModel):
    error: str
