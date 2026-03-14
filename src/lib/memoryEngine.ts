import { diff_match_patch } from 'diff-match-patch';
import type { MessageNode } from '../store/types';

// The engine that synchronizes Claude's text_editor / memory tool
// with the Time-Traveling Node Graph

const dmp = new diff_match_patch();

// Generates a lightweight text patch (RFC-like text format) from existing vs new text
export function computePatch(originalText: string, newText: string): string {
    const diffs = dmp.diff_main(originalText, newText);
    dmp.diff_cleanupSemantic(diffs);
    const patches = dmp.patch_make(originalText, diffs);
    return dmp.patch_toText(patches);
}

// Applies a text patch to the original text to reconstruct it
export function applyPatches(originalText: string, patchText: string): string {
    if (!patchText) return originalText;
    const patches = dmp.patch_fromText(patchText);
    const [newText] = dmp.patch_apply(patches, originalText);
    // Assuming conflict-free since timeline is strictly linear on any given branch
    return newText;
}

// Time-Travel Engine:
// Reconstructs the exact state of the /memories filesystem for a specific branch.
// It applies every diff from the root node down to the provided timeline leaf.
export function reconstructMemory(path: MessageNode[]): string {
    let memoryState = "{}"; // Initial empty JSON state

    for (const node of path) {
        for (const patch of node.memoryPatches) {
            memoryState = applyPatches(memoryState, patch.diffText);
        }
    }

    return memoryState;
}
