from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .artifacts import get_image_artifact, save_image_artifact
from .browser_import import close_browser
from .importers import import_shared_chat_from_url
from .models import ErrorResponse, ImageArtifactSaveRequest, ImageArtifactSaveResponse, SharedUrlImportRequest, SharedUrlImportResponse


app = FastAPI(title="MemoTree Import API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await close_browser()


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.post(
    "/api/import/fetch-shared",
    response_model=SharedUrlImportResponse,
    responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
)
async def fetch_shared_import(request: SharedUrlImportRequest) -> SharedUrlImportResponse:
    try:
        return await import_shared_chat_from_url(request.url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post(
    "/api/artifacts/images",
    response_model=ImageArtifactSaveResponse,
    responses={400: {"model": ErrorResponse}},
)
async def save_image_artifact_endpoint(request: ImageArtifactSaveRequest) -> ImageArtifactSaveResponse:
    return await save_image_artifact(request)


@app.get(
    "/api/artifacts/images/{artifact_id}/{file_name}",
    responses={404: {"model": ErrorResponse}},
)
async def get_image_artifact_endpoint(artifact_id: str, file_name: str):
    return await get_image_artifact(artifact_id, file_name)
