import type { MemoryPatch } from '../store/types';
import { computePatch, validateEaseMemory } from './memoryEngine';

export function interceptMemoryTool(
    toolArgs: Record<string, string>,
    currentMemoryState: string,
): { updatedMemory: string; patch: MemoryPatch; validationError?: string } {
    let newText = currentMemoryState;

    if (toolArgs.command === 'create') {
        if (toolArgs.file_text === undefined) {
            return {
                updatedMemory: currentMemoryState,
                patch: { diffText: '' },
                validationError: "The 'create' command requires file_text.",
            };
        }
        newText = toolArgs.file_text;
    } else if (toolArgs.command === 'str_replace') {
        if (!toolArgs.old_str) {
            return {
                updatedMemory: currentMemoryState,
                patch: { diffText: '' },
                validationError: "The 'str_replace' command requires a non-empty old_str.",
            };
        }
        if (toolArgs.new_str === undefined) {
            return {
                updatedMemory: currentMemoryState,
                patch: { diffText: '' },
                validationError: "The 'str_replace' command requires new_str.",
            };
        }
        if (!currentMemoryState.includes(toolArgs.old_str)) {
            return {
                updatedMemory: currentMemoryState,
                patch: { diffText: '' },
                validationError: "The 'str_replace' command did not match the current memory text.",
            };
        }
        newText = currentMemoryState.replace(toolArgs.old_str, toolArgs.new_str);
    } else {
        return {
            updatedMemory: currentMemoryState,
            patch: { diffText: '' },
            validationError: "Memory tool command must be 'create' or 'str_replace'.",
        };
    }

    const validationError = validateEaseMemory(newText) ?? undefined;
    if (validationError) {
        return { updatedMemory: currentMemoryState, patch: { diffText: '' }, validationError };
    }

    const diffText = computePatch(currentMemoryState, newText);
    return {
        updatedMemory: newText,
        patch: { diffText },
    };
}
