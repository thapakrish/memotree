from __future__ import annotations

from urllib.parse import urlparse

from .models import ImportSourcePlatform


class SharedUrlDetection:
    def __init__(self, platform: ImportSourcePlatform, normalized_url: str, is_supported: bool, label: str) -> None:
        self.platform = platform
        self.normalized_url = normalized_url
        self.is_supported = is_supported
        self.label = label


def detect_shared_import_url(raw_url: str) -> SharedUrlDetection | None:
    trimmed = raw_url.strip()
    if not trimmed:
        return None

    parsed = urlparse(trimmed)
    if not parsed.scheme or not parsed.netloc:
        return None

    host = parsed.hostname.lower() if parsed.hostname else ""
    pathname = parsed.path
    normalized_url = parsed.geturl()

    if host == "chatgpt.com" and pathname.startswith("/share/"):
        return SharedUrlDetection("chatgpt", normalized_url, True, "ChatGPT shared link")

    if (host == "g.co" and pathname.startswith("/gemini/share/")) or (
        host == "gemini.google.com" and "/share/" in pathname
    ):
        return SharedUrlDetection("gemini", normalized_url, True, "Gemini shared link")

    if host in {"claude.ai", "claude.site"} and "/share/" in pathname:
        return SharedUrlDetection("claude", normalized_url, True, "Claude shared link")

    return SharedUrlDetection("other", normalized_url, False, "Unknown shared link")
