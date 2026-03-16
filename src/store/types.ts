export interface MemoryPatch {
    // We store the stringified diff-match-patch output
    diffText: string;
}

export type ChatEvent =
    | {
        kind: 'thought';
        text: string;
        signature?: string;
        tokenCount?: number;
    }
    | {
        kind: 'tool_call';
        toolName: string;
        callId?: string;
        args: Record<string, unknown>;
    }
    | {
        kind: 'tool_result';
        toolName: string;
        callId?: string;
        status: 'success' | 'error';
        summary: string;
        payload?: unknown;
    }
    | {
        kind: 'text';
        text: string;
    };

export type MergeContextMode = 'full' | 'compact' | 'artifacts';

export interface BranchCapsule {
    sourceNodeId: string;
    label: string;
    mode: MergeContextMode;
    pathNodeIds: string[];
    summary: string;
    finalOutput: string;
    artifactLines: string[];
    body: string;
}

export interface MergeContext {
    commonAncestorId: string | null;
    sourceNodeIds: [string, string];
    mode: MergeContextMode;
    instruction: string;
    branchCapsules: [BranchCapsule, BranchCapsule];
    envelope: string;
}

export interface ContextGroup {
    id: string;
    name: string;
    color: string;
    contextMode: 'full' | 'compact' | 'result_only' | 'exclude';
    summary?: string;
    nodeIds: string[];
}

export interface MessageNode {
    id: string;
    parentId: string | null;
    parentIds?: string[];
    groupIds?: string[];
    kind?: 'message' | 'merge';
    role: 'user' | 'assistant' | 'system';
    content: string;
    events?: ChatEvent[];
    mergeContext?: MergeContext;
    memoryPatches: MemoryPatch[];
    timestamp: string; // ISO string
    summary?: string;
}

export interface ConversationGraph {
    nodes: Record<string, MessageNode>;
    groups: Record<string, ContextGroup>;
    rootId: string | null;
    activeNodeId: string | null;
    apiKey: string | null;
}
