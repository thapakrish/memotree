from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any

from bs4 import BeautifulSoup

from .models import ImportedTurn


def normalize_role(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.lower()
    if normalized in {"user", "human"}:
        return "user"
    if normalized in {"assistant", "model", "bot", "ai"}:
        return "assistant"
    if normalized in {"system", "developer"}:
        return "system"
    return None


def extract_text(value: Any, depth: int = 0) -> str:
    if depth > 8 or value is None:
        return ""

    if isinstance(value, str):
        return value.strip()

    if isinstance(value, list):
        return "\n".join(filter(None, (extract_text(item, depth + 1) for item in value))).strip()

    if not isinstance(value, dict):
        return ""

    for key in ("text", "value", "content"):
        field = value.get(key)
        if isinstance(field, str):
            return field.strip()

    for key in ("parts", "content", "message", "messages", "items"):
        nested = value.get(key)
        if nested is not None:
            nested_text = extract_text(nested, depth + 1)
            if nested_text:
                return nested_text

    return "\n".join(filter(None, (extract_text(item, depth + 1) for item in value.values()))).strip()


def to_imported_turn(value: Any) -> ImportedTurn | None:
    if not isinstance(value, dict):
        return None

    role = (
        normalize_role(value.get("role"))
        or normalize_role((value.get("author") or {}).get("role") if isinstance(value.get("author"), dict) else None)
        or normalize_role((value.get("message") or {}).get("role") if isinstance(value.get("message"), dict) else None)
        or normalize_role((value.get("message") or {}).get("author") if isinstance(value.get("message"), dict) else None)
        or normalize_role((value.get("metadata") or {}).get("role") if isinstance(value.get("metadata"), dict) else None)
    )
    if role is None:
        return None

    text = extract_text(value)
    if not text:
        return None

    return ImportedTurn(
        sourceTurnId=value.get("id") if isinstance(value.get("id"), str) else None,
        role=role,
        text=text,
    )


def score_turns(turns: list[ImportedTurn]) -> int:
    assistant_count = sum(turn.role == "assistant" for turn in turns)
    user_count = sum(turn.role == "user" for turn in turns)
    return len(turns) + assistant_count + user_count


def find_turn_candidates(value: Any, candidates: list[list[ImportedTurn]] | None = None) -> list[list[ImportedTurn]]:
    if candidates is None:
        candidates = []

    if isinstance(value, list):
        turns = [turn for turn in (to_imported_turn(item) for item in value) if turn is not None]
        if len(turns) >= 2 and any(turn.role == "user" for turn in turns) and any(turn.role == "assistant" for turn in turns):
            candidates.append(turns)

        for item in value:
            find_turn_candidates(item, candidates)
        return candidates

    if isinstance(value, dict):
        for nested in value.values():
            find_turn_candidates(nested, candidates)

    return candidates


def try_parse_json_block(script_content: str) -> Any | None:
    trimmed = script_content.strip()
    if not trimmed:
        return None

    if trimmed.startswith("{") or trimmed.startswith("["):
        try:
            return json.loads(trimmed)
        except json.JSONDecodeError:
            pass

    assignment_match = re.search(r"=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$", trimmed)
    if not assignment_match:
        return None

    try:
        return json.loads(assignment_match.group(1))
    except json.JSONDecodeError:
        return None


def extract_script_payloads(html: str) -> list[Any]:
    soup = BeautifulSoup(html, "html.parser")
    payloads: list[Any] = []
    for script in soup.find_all("script"):
        if not script.string:
            continue
        parsed = try_parse_json_block(script.string)
        if parsed is not None:
            payloads.append(parsed)
    return payloads


def extract_ld_json_blocks(html: str) -> list[Any]:
    soup = BeautifulSoup(html, "html.parser")
    payloads: list[Any] = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        content = script.string or script.text
        if not content:
            continue
        try:
            payloads.append(json.loads(content))
        except json.JSONDecodeError:
            continue
    return payloads


def best_candidate(candidates: Iterable[list[ImportedTurn]]) -> list[ImportedTurn]:
    ordered = sorted(candidates, key=score_turns, reverse=True)
    return ordered[0] if ordered else []
