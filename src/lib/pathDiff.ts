import type { MessageNode } from '../store/types';
import { diff_match_patch } from 'diff-match-patch';

const dmp = new diff_match_patch();

export interface PathDiff {
    /** Nodes shared by both paths, in order from root. */
    commonPrefix: MessageNode[];
    /** The last common ancestor node, or null if paths share no nodes. */
    commonAncestor: MessageNode | null;
    /** Nodes only on the left path (after the divergence point). */
    leftDivergence: MessageNode[];
    /** Nodes only on the right path (after the divergence point). */
    rightDivergence: MessageNode[];
}

export interface MemoryDiff {
    left: string;
    right: string;
    /** Inline diff segments: [text, side] where side is 'common' | 'left' | 'right' */
    segments: Array<{ text: string; side: 'common' | 'left' | 'right' }>;
    identical: boolean;
}

export function computePathDiff(
    leftPath: MessageNode[],
    rightPath: MessageNode[],
): PathDiff {
    // Walk from the start of each path and find all shared node IDs in order
    let divergeIndex = 0;
    const minLen = Math.min(leftPath.length, rightPath.length);

    while (divergeIndex < minLen && leftPath[divergeIndex].id === rightPath[divergeIndex].id) {
        divergeIndex++;
    }

    // divergeIndex is now the first index where paths differ
    const commonPrefix = leftPath.slice(0, divergeIndex);
    const commonAncestor = commonPrefix.length > 0 ? commonPrefix[commonPrefix.length - 1] : null;

    return {
        commonPrefix,
        commonAncestor,
        leftDivergence: leftPath.slice(divergeIndex),
        rightDivergence: rightPath.slice(divergeIndex),
    };
}

export function computeMemoryDiff(leftMemory: string, rightMemory: string): MemoryDiff {
    if (leftMemory === rightMemory) {
        return {
            left: leftMemory,
            right: rightMemory,
            segments: [{ text: leftMemory, side: 'common' }],
            identical: true,
        };
    }

    const diffs = dmp.diff_main(leftMemory, rightMemory);
    dmp.diff_cleanupSemantic(diffs);

    const segments = diffs.map(([op, text]) => ({
        text,
        side: op === 0 ? 'common' : op === -1 ? 'left' : 'right',
    })) as MemoryDiff['segments'];

    return { left: leftMemory, right: rightMemory, segments, identical: false };
}
