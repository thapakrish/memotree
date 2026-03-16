import type { ImportedTurn } from '../../store/types';
import { parsePlainTranscript } from './parsePlainTranscript';

function normalizeMarkdownLine(line: string) {
    return line
        .replace(/^>\s?/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^#{1,6}\s+/, '')
        .trimEnd();
}

export function parseMarkdownTranscript(input: string): ImportedTurn[] {
    const normalized = input
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(normalizeMarkdownLine)
        .join('\n')
        .trim();

    if (!normalized) {
        return [];
    }

    return parsePlainTranscript(normalized);
}
