import type { ImportedTurn } from '../../store/types';

const ROLE_PATTERNS: Array<{ role: ImportedTurn['role']; pattern: RegExp }> = [
    { role: 'user', pattern: /^(?:user|you|human|me)\s*:\s*(.*)$/i },
    { role: 'assistant', pattern: /^(?:assistant|chatgpt|claude|gemini|ai|bot)\s*:\s*(.*)$/i },
    { role: 'system', pattern: /^(?:system|developer)\s*:\s*(.*)$/i },
];

function inferRoleFromLine(line: string) {
    for (const candidate of ROLE_PATTERNS) {
        const match = line.match(candidate.pattern);
        if (match) {
            return {
                role: candidate.role,
                text: match[1]?.trim() ?? '',
            };
        }
    }

    return null;
}

export function parsePlainTranscript(input: string): ImportedTurn[] {
    const normalized = input.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return [];
    }

    const turns: ImportedTurn[] = [];
    let currentTurn: ImportedTurn | null = null;

    for (const rawLine of normalized.split('\n')) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            if (currentTurn) {
                currentTurn.text += '\n';
            }
            continue;
        }

        const inferred = inferRoleFromLine(line.trim());
        if (inferred) {
            if (currentTurn) {
                currentTurn.text = currentTurn.text.trim();
                if (currentTurn.text) {
                    turns.push(currentTurn);
                }
            }

            currentTurn = {
                role: inferred.role,
                text: inferred.text,
            };
            continue;
        }

        if (!currentTurn) {
            currentTurn = {
                role: 'user',
                text: line.trim(),
            };
            continue;
        }

        currentTurn.text = currentTurn.text
            ? `${currentTurn.text}\n${line.trim()}`
            : line.trim();
    }

    if (currentTurn) {
        currentTurn.text = currentTurn.text.trim();
        if (currentTurn.text) {
            turns.push(currentTurn);
        }
    }

    return turns;
}
