from __future__ import annotations

from dataclasses import dataclass

from .models import ImportSourcePlatform, ImportedTurn, InferenceConfidence
from .parser_utils import best_candidate, extract_ld_json_blocks, extract_script_payloads, extract_text, find_turn_candidates


@dataclass
class ExtractionResult:
    turns: list[ImportedTurn]
    parser_name: str
    parser_confidence: InferenceConfidence
    warnings: list[str] | None = None


def generic_json_parser(html: str) -> ExtractionResult | None:
    payloads = extract_script_payloads(html)
    candidates = []
    for payload in payloads:
        candidates.extend(find_turn_candidates(payload))

    turns = best_candidate(candidates)
    if not turns:
        return None

    return ExtractionResult(
        turns=turns,
        parser_name="generic-json",
        parser_confidence="low",
        warnings=["Transcript was extracted with a generic shared-page parser. Review the imported turns carefully."],
    )


def parse_claude_shared(html: str) -> ExtractionResult | None:
    for block in extract_ld_json_blocks(html):
        text = extract_text(block)
        if not text:
            continue

        lines = [line.strip() for line in text.splitlines() if line.strip()]
        turns = [
            ImportedTurn(role="user" if index % 2 == 0 else "assistant", text=line)
            for index, line in enumerate(lines)
        ]

        if len(turns) >= 2:
            return ExtractionResult(
                turns=turns,
                parser_name="claude-ld-json",
                parser_confidence="medium",
                warnings=["Claude shared chats may omit attached files and raw MCP tool outputs."],
            )

    return None


def parse_chatgpt_shared(html: str) -> ExtractionResult | None:
    if "chatgpt.com/share/" not in html:
        return None

    generic = generic_json_parser(html)
    if generic is None:
        return None

    return ExtractionResult(
        turns=generic.turns,
        parser_name="chatgpt-shared-json",
        parser_confidence="medium" if len(generic.turns) >= 4 else "low",
        warnings=["ChatGPT shared links expose a visible snapshot only. Saved memory and project memory are not included."],
    )


def parse_gemini_shared(html: str) -> ExtractionResult | None:
    if "gemini" not in html.lower():
        return None

    generic = generic_json_parser(html)
    if generic is None:
        return None

    return ExtractionResult(
        turns=generic.turns,
        parser_name="gemini-shared-json",
        parser_confidence="medium" if len(generic.turns) >= 4 else "low",
        warnings=["Gemini shared imports may not include hidden personalization, connected apps, or device/location context."],
    )


def provider_parsers(platform: ImportSourcePlatform):
    if platform == "chatgpt":
        return [parse_chatgpt_shared, generic_json_parser]
    if platform == "claude":
        return [parse_claude_shared, generic_json_parser]
    if platform == "gemini":
        return [parse_gemini_shared, generic_json_parser]
    return [generic_json_parser]
