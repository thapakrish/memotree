import type { ImportSourcePlatform, ImportedTurn } from '../../store/types';
import { parseMarkdownTranscript } from './parseMarkdownTranscript';
import { parsePlainTranscript } from './parsePlainTranscript';
import { sanitizeImportedTurns } from './validateImportedTurns';

export interface NormalizeTranscriptInput {
    sourcePlatform: ImportSourcePlatform;
    text: string;
    formatHint?: 'plain' | 'markdown' | 'auto';
}

export interface NormalizedTranscript {
    sourcePlatform: ImportSourcePlatform;
    turns: ImportedTurn[];
}

function detectFormat(text: string) {
    const normalized = text.replace(/\r\n/g, '\n');
    const markdownSignals = [
        /^#{1,6}\s+/m,
        /^>\s+/m,
        /^[-*]\s+(?:user|assistant|chatgpt|claude|gemini|system)\s*:/im,
        /\*\*(?:user|assistant|chatgpt|claude|gemini|system)\*\*/i,
    ];

    return markdownSignals.some((pattern) => pattern.test(normalized)) ? 'markdown' : 'plain';
}

export function normalizeTranscript(input: NormalizeTranscriptInput): NormalizedTranscript {
    const trimmed = input.text.trim();
    if (!trimmed) {
        return {
            sourcePlatform: input.sourcePlatform,
            turns: [],
        };
    }

    const format = input.formatHint && input.formatHint !== 'auto'
        ? input.formatHint
        : detectFormat(trimmed);

    const parsedTurns = format === 'markdown'
        ? parseMarkdownTranscript(trimmed)
        : parsePlainTranscript(trimmed);
    const turns = sanitizeImportedTurns(parsedTurns);

    return {
        sourcePlatform: input.sourcePlatform,
        turns,
    };
}
