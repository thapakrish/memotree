from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ImportSourcePlatform = Literal["chatgpt", "claude", "gemini", "other"]
InferenceConfidence = Literal["high", "medium", "low"]
ImportedRole = Literal["user", "assistant", "system"]
ImageArtifactMimeType = Literal["image/jpeg", "image/png", "image/webp", "image/gif"]


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


class ImageArtifactSaveRequest(BaseModel):
    artifactId: str = Field(min_length=1, max_length=120)
    fileName: str = Field(min_length=1, max_length=180)
    mimeType: ImageArtifactMimeType
    data: str = Field(min_length=1)
    sessionId: str | None = Field(default=None, max_length=120)


class ImageArtifactSaveResponse(BaseModel):
    artifactId: str
    path: str
    url: str
    mimeType: ImageArtifactMimeType
    sizeBytes: int


class ImageArtifactsDeleteRequest(BaseModel):
    artifactIds: list[str] = Field(min_length=1, max_length=500)


class ImageArtifactsDeleteResponse(BaseModel):
    deletedCount: int


class ErrorResponse(BaseModel):
    error: str
