export interface MemoryPatch {
    // We store the stringified diff-match-patch output
    diffText: string;
}

export interface AssistantContentPart {
    kind: 'thought' | 'text';
    text: string;
    signature?: string;
}

export interface MessageNode {
    id: string;
    parentId: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    assistantParts?: AssistantContentPart[];
    thoughtsTokenCount?: number;
    memoryPatches: MemoryPatch[];
    timestamp: string; // ISO string
    summary?: string;
}

export interface ConversationGraph {
    nodes: Record<string, MessageNode>;
    rootId: string | null;
    activeNodeId: string | null;
    apiKey: string | null;
}
