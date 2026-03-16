from __future__ import annotations

from urllib.parse import urlparse

import httpx

from .adapters import provider_parsers
from .browser_import import browser_fallback_enabled, fetch_rendered_html
from .detectors import detect_shared_import_url
from .models import SharedUrlImportResponse


def extract_conversation_id(raw_url: str) -> str | None:
    parsed = urlparse(raw_url)
    parts = [part for part in parsed.path.split("/") if part]
    return parts[-1] if parts else None


def provider_user_agent(platform: str) -> str:
    return (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/122.0.0.0 Safari/537.36 MemoTree/{platform}"
    )


async def import_shared_chat_from_url(raw_url: str) -> SharedUrlImportResponse:
    detection = detect_shared_import_url(raw_url)
    if detection is None or not detection.is_supported:
        raise ValueError("Unsupported shared URL. Use a public ChatGPT, Gemini, or Claude share link.")

    timeout = httpx.Timeout(20.0, connect=10.0)
    headers = {
        "User-Agent": provider_user_agent(detection.platform),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    network_warning: str | None = None

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            response = await client.get(detection.normalized_url)
    except httpx.TimeoutException as error:
        network_warning = (
            "Timed out while fetching the shared chat page over plain HTTP. Falling back to browser automation."
        )
        response = None
    except httpx.HTTPError as error:
        network_warning = f"Plain HTTP fetch failed ({error}). Falling back to browser automation."
        response = None

    html: str | None = None

    if response is not None:
        if response.status_code >= 400:
            network_warning = f"Provider returned {response.status_code} for plain HTTP fetch. Falling back to browser automation."
        else:
            html = response.text

    def parse_html(candidate_html: str, extra_warnings: list[str] | None = None) -> SharedUrlImportResponse | None:
        for parser in provider_parsers(detection.platform):
            result = parser(candidate_html)
            if result and result.turns:
                warnings = list(result.warnings or [])
                if extra_warnings:
                    warnings = [*extra_warnings, *warnings]
                return SharedUrlImportResponse(
                    sourcePlatform=detection.platform,
                    sourceConversationId=extract_conversation_id(detection.normalized_url),
                    turns=result.turns,
                    parserConfidence=result.parser_confidence,
                    parserName=result.parser_name,
                    warnings=warnings or None,
                )
        return None

    if html is not None:
        parsed = parse_html(html)
        if parsed is not None:
            return parsed
        network_warning = "Plain HTTP fetch succeeded, but transcript extraction failed. Falling back to browser automation."

    if not browser_fallback_enabled():
        if network_warning:
            raise RuntimeError(f"{network_warning} Browser fallback is disabled in this environment.")
        raise RuntimeError("Unable to extract transcript turns from the shared page snapshot.")

    try:
        rendered_html = await fetch_rendered_html(detection.normalized_url)
    except TimeoutError as error:
        raise TimeoutError(
            "Timed out while fetching the shared chat page. Both plain HTTP and browser fallback were unsuccessful."
        ) from error
    except RuntimeError as error:
        if network_warning:
            raise RuntimeError(f"{network_warning} {error}") from error
        raise

    parsed = parse_html(
        rendered_html,
        [network_warning] if network_warning else ["Transcript was extracted after browser rendering fallback."],
    )
    if parsed is not None:
        return parsed

    for parser in provider_parsers(detection.platform):
        result = parser(rendered_html)
        if result and result.turns:
            warnings = list(result.warnings or [])
            if network_warning:
                warnings.insert(0, network_warning)
            warnings.insert(0, "Transcript was extracted after browser rendering fallback.")
            return SharedUrlImportResponse(
                sourcePlatform=detection.platform,
                sourceConversationId=extract_conversation_id(detection.normalized_url),
                turns=result.turns,
                parserConfidence=result.parser_confidence,
                parserName=result.parser_name,
                warnings=warnings,
            )

    raise RuntimeError("Unable to extract transcript turns from the shared page snapshot.")
