from __future__ import annotations

import base64
import binascii
import mimetypes
import os
import re
import shutil
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from .models import ImageArtifactSaveRequest, ImageArtifactSaveResponse, ImageArtifactsDeleteRequest, ImageArtifactsDeleteResponse


SAFE_PATH_COMPONENT = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")


def get_artifact_root() -> Path:
    configured_root = os.environ.get("MEMOTREE_ARTIFACT_DIR")
    if configured_root:
        return Path(configured_root).expanduser().resolve()
    return (Path(__file__).resolve().parents[2] / "artifacts").resolve()


def validate_path_component(value: str, label: str) -> str:
    if not SAFE_PATH_COMPONENT.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return value


def decode_base64_image(data: str) -> bytes:
    payload = data.split(",", 1)[1] if data.startswith("data:") and "," in data else data
    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Image data must be valid base64.") from error


def ensure_child_path(root: Path, path: Path) -> Path:
    resolved_root = root.resolve()
    resolved_path = path.resolve()
    if resolved_path != resolved_root and resolved_root not in resolved_path.parents:
        raise HTTPException(status_code=400, detail="Artifact path escapes the artifact root.")
    return resolved_path


async def save_image_artifact(request: ImageArtifactSaveRequest) -> ImageArtifactSaveResponse:
    artifact_id = validate_path_component(request.artifactId, "artifact id")
    file_name = validate_path_component(Path(request.fileName).name, "file name")
    image_bytes = decode_base64_image(request.data)

    artifact_root = get_artifact_root()
    target_dir = ensure_child_path(artifact_root, artifact_root / "images" / artifact_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = ensure_child_path(artifact_root, target_dir / file_name)
    target_path.write_bytes(image_bytes)

    path = f"/artifacts/images/{artifact_id}/{file_name}"
    url = f"/api/artifacts/images/{artifact_id}/{file_name}"
    return ImageArtifactSaveResponse(
        artifactId=artifact_id,
        path=path,
        url=url,
        mimeType=request.mimeType,
        sizeBytes=len(image_bytes),
    )


async def get_image_artifact(artifact_id: str, file_name: str) -> FileResponse:
    safe_artifact_id = validate_path_component(artifact_id, "artifact id")
    safe_file_name = validate_path_component(Path(file_name).name, "file name")
    artifact_root = get_artifact_root()
    target_path = ensure_child_path(artifact_root, artifact_root / "images" / safe_artifact_id / safe_file_name)

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="Image artifact not found.")

    media_type = mimetypes.guess_type(target_path.name)[0] or "application/octet-stream"
    return FileResponse(target_path, media_type=media_type, filename=target_path.name)


async def delete_image_artifacts(request: ImageArtifactsDeleteRequest) -> ImageArtifactsDeleteResponse:
    artifact_root = get_artifact_root()
    artifact_ids = {validate_path_component(raw_artifact_id, "artifact id") for raw_artifact_id in request.artifactIds}
    deleted_count = 0

    for artifact_id in artifact_ids:
        target_dir = ensure_child_path(artifact_root, artifact_root / "images" / artifact_id)
        if not target_dir.exists():
            continue
        if not target_dir.is_dir():
            raise HTTPException(status_code=400, detail="Artifact path is not a directory.")

        shutil.rmtree(target_dir)
        deleted_count += 1

    return ImageArtifactsDeleteResponse(deletedCount=deleted_count)
