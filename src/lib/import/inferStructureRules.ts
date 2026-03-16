import type { ImportedTurn, StructureSuggestion } from '../../store/types';

const HIGH_CONFIDENCE_RESET_PATTERNS = [
    /\bactually\b/i,
    /\binstead\b/i,
    /\bstart over\b/i,
    /\bforget (that|previous|everything above)\b/i,
    /\bignore (that|the previous|everything above)\b/i,
    /\bnew topic\b/i,
    /\bdifferent approach\b/i,
];

const EXPLICIT_RETURN_PATTERNS = [
    /\bgo back to\b/i,
    /\bback to\b/i,
    /\breturn to\b/i,
    /\bresume\b/i,
];

const MEDIUM_CONFIDENCE_DETOUR_PATTERNS = [
    /\bside note\b/i,
    /\bquick detour\b/i,
    /\bbefore that\b/i,
    /\bone more thing\b/i,
    /\bsmall question\b/i,
];

function tokenize(text: string) {
    return new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/i)
            .filter((token) => token.length >= 4),
    );
}

function overlapScore(left: string, right: string) {
    const leftTokens = tokenize(left);
    const rightTokens = tokenize(right);

    if (leftTokens.size === 0 || rightTokens.size === 0) {
        return 0;
    }

    let overlap = 0;
    for (const token of leftTokens) {
        if (rightTokens.has(token)) {
            overlap += 1;
        }
    }

    return overlap / Math.min(leftTokens.size, rightTokens.size);
}

export function inferStructureRules(turns: ImportedTurn[]): StructureSuggestion[] {
    const suggestions: StructureSuggestion[] = [];
    const userTurns = turns
        .map((turn, index) => ({ turn, index }))
        .filter(({ turn }) => turn.role === 'user');

    for (const { turn, index } of userTurns) {
        const text = turn.text.trim();
        if (!text) {
            continue;
        }

        if (EXPLICIT_RETURN_PATTERNS.some((pattern) => pattern.test(text))) {
            let bestAnchorIndex = -1;
            let bestScore = 0;

            for (let candidate = 0; candidate < userTurns.length; candidate += 1) {
                if (candidate >= userTurns.findIndex((entry) => entry.index === index)) {
                    break;
                }

                const score = overlapScore(text, userTurns[candidate].turn.text);
                if (score > bestScore) {
                    bestScore = score;
                    bestAnchorIndex = candidate;
                }
            }

            if (bestAnchorIndex >= 0 && bestScore > 0) {
                suggestions.push({
                    id: `rule-explicit-resume-${index}`,
                    kind: 'resume_link',
                    turnIds: [String(index)],
                    anchorTurnId: String(userTurns[bestAnchorIndex].index),
                    inferenceMethod: 'rule',
                    confidence: bestScore >= 0.2 ? 'high' : 'medium',
                    rationale: 'The turn explicitly asks to go back or return to an earlier thread.',
                });
                continue;
            }
        }

        if (HIGH_CONFIDENCE_RESET_PATTERNS.some((pattern) => pattern.test(text))) {
            suggestions.push({
                id: `rule-reset-${index}`,
                kind: 'reset',
                turnIds: [String(index)],
                inferenceMethod: 'rule',
                confidence: 'high',
                rationale: 'The turn contains explicit reset or redirection language.',
            });
            continue;
        }

        if (MEDIUM_CONFIDENCE_DETOUR_PATTERNS.some((pattern) => pattern.test(text))) {
            suggestions.push({
                id: `rule-detour-${index}`,
                kind: 'detour_span',
                turnIds: [String(index)],
                inferenceMethod: 'rule',
                confidence: 'medium',
                rationale: 'The turn contains phrasing that often signals a temporary detour.',
            });
        }
    }

    for (let current = 2; current < userTurns.length; current += 1) {
        const currentTurn = userTurns[current];
        const previousTurn = userTurns[current - 1];

        let bestAnchorIndex = -1;
        let bestScore = 0;

        for (let candidate = 0; candidate < current - 1; candidate += 1) {
            const score = overlapScore(currentTurn.turn.text, userTurns[candidate].turn.text);
            if (score > bestScore) {
                bestScore = score;
                bestAnchorIndex = candidate;
            }
        }

        const previousScore = overlapScore(currentTurn.turn.text, previousTurn.turn.text);
        if (bestAnchorIndex >= 0 && bestScore >= 0.5 && bestScore > previousScore + 0.2) {
            suggestions.push({
                id: `rule-resume-${currentTurn.index}`,
                kind: 'resume_link',
                turnIds: [String(currentTurn.index)],
                anchorTurnId: String(userTurns[bestAnchorIndex].index),
                inferenceMethod: 'rule',
                confidence: 'medium',
                rationale: 'This turn overlaps more strongly with an earlier user turn than with the immediately previous one.',
            });
        }
    }

    return suggestions;
}
