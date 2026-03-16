import type { ImportSourcePlatform, ImportedTurn, InferenceConfidence } from '../../store/types';
import { detectSharedImportUrl } from './sharedUrl';
import type { SharedUrlImportResponse } from './sharedImportApi';

interface ExtractionResult {
    turns: ImportedTurn[];
    parserName: string;
    parserConfidence: InferenceConfidence;
    warnings?: string[];
}

function normalizeRole(value: unknown): ImportedTurn['role'] | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.toLowerCase();
    if (['user', 'human'].includes(normalized)) return 'user';
    if (['assistant', 'model', 'bot', 'ai'].includes(normalized)) return 'assistant';
    if (['system', 'developer'].includes(normalized)) return 'system';
    return null;
}

function extractText(value: unknown, depth = 0): string {
    if (depth > 8 || value == null) {
        return '';
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => extractText(item, depth + 1))
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (typeof value !== 'object') {
        return '';
    }

    const record = value as Record<string, unknown>;

    if (typeof record.text === 'string') return record.text.trim();
    if (typeof record.value === 'string') return record.value.trim();
    if (typeof record.content === 'string') return record.content.trim();

    for (const key of ['parts', 'content', 'message', 'messages', 'items']) {
        if (record[key] != null) {
            const nested = extractText(record[key], depth + 1);
            if (nested) return nested;
        }
    }

    return Object.values(record)
        .map((item) => extractText(item, depth + 1))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function toImportedTurn(value: unknown): ImportedTurn | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const record = value as Record<string, unknown>;
    const role =
        normalizeRole(record.role) ||
        normalizeRole((record.author as Record<string, unknown> | undefined)?.role) ||
        normalizeRole((record.message as Record<string, unknown> | undefined)?.role) ||
        normalizeRole((record.message as Record<string, unknown> | undefined)?.author) ||
        normalizeRole((record.metadata as Record<string, unknown> | undefined)?.role);

    if (!role) {
        return null;
    }

    const text = extractText(record);
    if (!text) {
        return null;
    }

    return {
        role,
        text,
        sourceTurnId: typeof record.id === 'string' ? record.id : undefined,
    };
}

function scoreTurns(turns: ImportedTurn[]) {
    const assistantCount = turns.filter((turn) => turn.role === 'assistant').length;
    const userCount = turns.filter((turn) => turn.role === 'user').length;
    return turns.length + assistantCount + userCount;
}

function findTurnCandidates(value: unknown, candidates: ImportedTurn[][] = []): ImportedTurn[][] {
    if (Array.isArray(value)) {
        const turns = value
            .map((item) => toImportedTurn(item))
            .filter((turn): turn is ImportedTurn => Boolean(turn));

        if (turns.length >= 2 && turns.some((turn) => turn.role === 'user') && turns.some((turn) => turn.role === 'assistant')) {
            candidates.push(turns);
        }

        for (const item of value) {
            findTurnCandidates(item, candidates);
        }

        return candidates;
    }

    if (!value || typeof value !== 'object') {
        return candidates;
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
        findTurnCandidates(nested, candidates);
    }

    return candidates;
}

function tryParseJsonBlock(scriptContent: string): unknown | null {
    const trimmed = scriptContent.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            // Keep trying assignment-style extraction.
        }
    }

    const assignmentMatch = trimmed.match(/=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$/);
    if (!assignmentMatch) {
        return null;
    }

    try {
        return JSON.parse(assignmentMatch[1]);
    } catch {
        return null;
    }
}

function extractScriptPayloads(html: string): unknown[] {
    const payloads: unknown[] = [];
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = scriptRegex.exec(html)) !== null) {
        const parsed = tryParseJsonBlock(match[1]);
        if (parsed != null) {
            payloads.push(parsed);
        }
    }

    return payloads;
}

function genericJsonParser(html: string): ExtractionResult | null {
    const payloads = extractScriptPayloads(html);
    const candidates = payloads.flatMap((payload) => findTurnCandidates(payload));
    if (candidates.length === 0) {
        return null;
    }

    const turns = candidates.sort((left, right) => scoreTurns(right) - scoreTurns(left))[0];
    return {
        turns,
        parserName: 'generic-json',
        parserConfidence: 'low',
        warnings: ['Transcript was extracted with a generic shared-page parser. Review the imported turns carefully.'],
    };
}

function extractLdJsonBlocks(html: string): unknown[] {
    const payloads: unknown[] = [];
    const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = scriptRegex.exec(html)) !== null) {
        try {
            payloads.push(JSON.parse(match[1]));
        } catch {
            // Ignore malformed ld+json blocks.
        }
    }

    return payloads;
}

function textFromLdJson(value: unknown): string {
    if (!value || typeof value !== 'object') {
        return '';
    }

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
        return record.text.trim();
    }

    if (typeof record.articleBody === 'string') {
        return record.articleBody.trim();
    }

    return '';
}

function parseClaudeShared(html: string): ExtractionResult | null {
    const blocks = extractLdJsonBlocks(html);
    for (const block of blocks) {
        const text = textFromLdJson(block);
        if (!text) {
            continue;
        }

        const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        const turns = lines.map((line, index) => ({
            role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
            text: line,
        }));

        if (turns.length >= 2) {
            return {
                turns,
                parserName: 'claude-ld-json',
                parserConfidence: 'medium',
                warnings: ['Claude shared chats may omit files and raw MCP tool outputs.'],
            };
        }
    }

    return null;
}

function parseChatGptShared(html: string): ExtractionResult | null {
    if (!html.includes('chatgpt.com/share/')) {
        return null;
    }

    const generic = genericJsonParser(html);
    if (!generic) {
        return null;
    }

    return {
        ...generic,
        parserName: 'chatgpt-shared-json',
        parserConfidence: generic.turns.length >= 4 ? 'medium' : 'low',
        warnings: ['ChatGPT shared links are imported from the visible snapshot only. Saved memory and project memory are not part of this import.'],
    };
}

function parseGeminiShared(html: string): ExtractionResult | null {
    if (!html.includes('gemini')) {
        return null;
    }

    const generic = genericJsonParser(html);
    if (!generic) {
        return null;
    }

    return {
        ...generic,
        parserName: 'gemini-shared-json',
        parserConfidence: generic.turns.length >= 4 ? 'medium' : 'low',
        warnings: ['Gemini shared imports may not include hidden personalization, connected apps, or device/location context.'],
    };
}

function providerParsers(platform: ImportSourcePlatform) {
    switch (platform) {
        case 'chatgpt':
            return [parseChatGptShared, genericJsonParser];
        case 'claude':
            return [parseClaudeShared, genericJsonParser];
        case 'gemini':
            return [parseGeminiShared, genericJsonParser];
        default:
            return [genericJsonParser];
    }
}

function extractConversationId(url: URL) {
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.at(-1);
}

function providerUserAgent(platform: ImportSourcePlatform) {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 MemoTree/${platform}`;
}

export async function importSharedChatFromUrl(rawUrl: string): Promise<SharedUrlImportResponse> {
    const detection = detectSharedImportUrl(rawUrl);
    if (!detection || !detection.isSupported) {
        throw new Error('Unsupported shared URL. Use a public ChatGPT, Gemini, or Claude share link.');
    }

    let response: Response;
    try {
        response = await fetch(detection.normalizedUrl, {
            headers: {
                'User-Agent': providerUserAgent(detection.platform),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(20000),
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') {
            throw new Error('Timed out while fetching the shared chat page. ChatGPT share links may block or delay server-side fetches from this environment.');
        }

        throw new Error(`Unable to fetch the shared chat page: ${error instanceof Error ? error.message : 'unknown network error'}`);
    }

    if (!response.ok) {
        throw new Error(`Provider returned ${response.status} while fetching the shared chat.`);
    }

    const html = await response.text();
    const parsers = providerParsers(detection.platform);

    for (const parser of parsers) {
        const result = parser(html);
        if (result && result.turns.length > 0) {
            return {
                sourcePlatform: detection.platform,
                sourceConversationId: extractConversationId(new URL(detection.normalizedUrl)),
                turns: result.turns,
                parserName: result.parserName,
                parserConfidence: result.parserConfidence,
                warnings: result.warnings,
            };
        }
    }

    throw new Error('Unable to extract transcript turns from the shared page snapshot.');
}
