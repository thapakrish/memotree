import type { ImportedTurn } from '../../store/types';

const VALID_ROLES = new Set<ImportedTurn['role']>(['user', 'assistant', 'system']);

function normalizeText(text: unknown) {
    if (typeof text !== 'string') {
        return '';
    }

    return text.replace(/\r\n/g, '\n').trim();
}

export function sanitizeImportedTurns(turns: ImportedTurn[]): ImportedTurn[] {
    return turns.flatMap((turn) => {
        if (!turn || !VALID_ROLES.has(turn.role)) {
            return [];
        }

        const text = normalizeText(turn.text);
        if (!text) {
            return [];
        }

        return [{
            ...turn,
            text,
        }];
    });
}
