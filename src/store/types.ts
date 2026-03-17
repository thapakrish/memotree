export interface MemoryPatch {
    // We store the stringified diff-match-patch output
    diffText: string;
}

export type AttachmentMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface AttachmentPart {
    id: string;
    kind: 'image';
    mimeType: AttachmentMimeType;
    /** Base64-encoded image data (no data URL prefix). */
    data: string;
    name?: string;
    sizeBytes?: number;
    sourceType: 'clipboard' | 'file' | 'drop';
}

export type ImportSourcePlatform = 'chatgpt' | 'claude' | 'gemini' | 'other';
export type ImportMode = 'linear' | 'assisted' | 'deep';
export type InferenceMethod = 'rule' | 'llm' | 'user';
export type InferenceConfidence = 'high' | 'medium' | 'low';

export interface ImportedAttachment {
    name?: string;
    mimeType?: string;
    url?: string;
}

export interface ImportedTurn {
    sourceTurnId?: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    timestamp?: string;
    attachments?: ImportedAttachment[];
    raw?: unknown;
}

export interface ImportMetadata {
    origin: 'native' | 'imported';
    sourcePlatform?: ImportSourcePlatform;
    sourceConversationId?: string;
    sourceTurnId?: string;
    sourceTurnIndex?: number;
    importedAt?: string;
}

export interface InferenceMetadata {
    inferred: boolean;
    inferenceMethod?: InferenceMethod;
    confidence?: InferenceConfidence;
    rationale?: string;
    suggestionId?: string;
    confirmedByUser?: boolean;
}

export interface HiddenContextProvenance {
    visibleTranscriptOnly: boolean;
    possibleAccountMemory: boolean;
    possibleProjectMemory: boolean;
    possibleRetrieval: boolean;
    possibleConnectedAppContext: boolean;
    unknownHiddenContext: boolean;
    notes?: string[];
}

export interface StructureSuggestion {
    id: string;
    kind: 'branch_start' | 'detour_span' | 'resume_link' | 'reset';
    turnIds: string[];
    anchorTurnId?: string;
    inferenceMethod: InferenceMethod;
    confidence: InferenceConfidence;
    rationale: string;
    status?: 'pending' | 'accepted' | 'rejected';
}

export interface ImportedConversationEnvelope {
    sourcePlatform: ImportSourcePlatform;
    importMode: ImportMode;
    importedAt: string;
    messageCount: number;
    sourceConversationId?: string;
    parserConfidence?: InferenceConfidence;
    importWarnings?: string[];
    hiddenContext: HiddenContextProvenance;
    suggestions?: StructureSuggestion[];
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

export interface GraphUiPosition {
    x: number;
    y: number;
}

export interface MessageNode {
    id: string;
    parentId: string | null;
    parentIds?: string[];
    groupIds?: string[];
    kind?: 'message' | 'merge';
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: AttachmentPart[];
    events?: ChatEvent[];
    mergeContext?: MergeContext;
    memoryPatches: MemoryPatch[];
    timestamp: string; // ISO string
    summary?: string;
    importMetadata?: ImportMetadata;
    inferenceMetadata?: InferenceMetadata;
}

export interface ConversationGraph {
    nodes: Record<string, MessageNode>;
    groups: Record<string, ContextGroup>;
    uiPositions: Record<string, GraphUiPosition>;
    rootId: string | null;
    activeNodeId: string | null;
    apiKey: string | null;
    importEnvelope?: ImportedConversationEnvelope;
}
