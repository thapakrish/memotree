import { create } from 'zustand';
import type { ProviderId } from '../lib/providers';
import type {
    AttachmentPart,
    ChatEvent,
    CompactionBlock,
    ContextGroup,
    ImageFileArtifact,
    ImageFileUse,
    ImageArtifactStorageUpdate,
    ImportedTurn,
    ImportSourcePlatform,
    ImportMode,
    MessageNode,
    ConversationGraph,
    MemoryPatch,
    SessionIntent,
    StructureSuggestion,
} from './types';
import { buildImageArtifactFileName, buildImageArtifactPath, buildImageArtifactUrl } from '../lib/artifactFiles';
import { deriveSessionTitle, loadLastSession, loadSession, markLastSession, saveSession, type PersistedSession, validatePersistedSession } from '../lib/sessionPersistence';
import { applyAcceptedStructureSuggestions } from '../lib/import/applyStructureSuggestions';
import { inferStructureRules } from '../lib/import/inferStructureRules';
import { sanitizeImportedTurns } from '../lib/import/validateImportedTurns';
import { DEFAULT_IMAGE_MODEL_ID, DEFAULT_IMAGEN_OUTPUT_COUNT } from '../lib/geminiModels';

interface GraphState extends ConversationGraph {
    sessionId: string;
    createdAt: string;
    isHydrated: boolean;
    isSaving: boolean;
    lastSavedAt: string | null;
    saveError: string | null;
    selectedNodeIds: string[];
    canvasSelectedArtifactIds: string[];
    canvasSelectedArtifactUse: ImageFileUse;
    previewNodes: Record<string, MessageNode> | null;
    previewImportEnvelope: GraphState['importEnvelope'] | null;
    lastImportApplySnapshot: Pick<ConversationGraph, 'nodes' | 'importEnvelope' | 'uiPositions'> | null;
    hydrateSession: () => Promise<void>;
    createNewSession: () => void;
    loadSessionById: (sessionId: string) => Promise<void>;
    loadSessionFromData: (session: PersistedSession) => Promise<void>;
    importLinearTranscript: (payload: {
        sourcePlatform: ImportSourcePlatform;
        turns: ImportedTurn[];
        sourceConversationId?: string;
        parserConfidence?: 'high' | 'medium' | 'low';
        importWarnings?: string[];
    }) => string | null;
    updateImportSuggestionStatus: (suggestionId: string, status: 'accepted' | 'rejected' | 'pending') => void;
    applyHighConfidenceImportSuggestions: () => void;
    applyAcceptedImportSuggestions: () => number;
    commitImportSuggestions: (suggestions: StructureSuggestion[]) => number;
    previewImportSuggestions: (suggestions: StructureSuggestion[]) => void;
    clearImportPreview: () => void;
    undoLastImportApply: () => void;
    toggleNodeSelection: (id: string) => void;
    setSelectedNodeIds: (ids: string[]) => void;
    clearNodeSelection: () => void;
    pruneCanvasNodes: (ids: string[]) => void;
    restoreCanvasPruning: () => void;
    toggleCanvasArtifactSelection: (id: string) => void;
    setCanvasArtifactSelection: (ids: string[], use?: ImageFileUse) => void;
    setCanvasArtifactSelectionUse: (use: ImageFileUse) => void;
    clearCanvasArtifactSelection: () => void;
    addCompaction: (block: CompactionBlock) => void;
    removeCompaction: (id: string) => void;
    createGroup: (group: Omit<ContextGroup, 'id'>) => string;
    addNode: (node: Omit<MessageNode, 'id' | 'timestamp'>) => string;
    markImageArtifactsStored: (updates: ImageArtifactStorageUpdate[]) => void;
    setUiPosition: (id: string, position: { x: number; y: number }) => void;
    setActiveNode: (id: string | null) => void;
    updateNodeSummary: (id: string, summary: string) => void;
    addMemoryPatch: (nodeId: string, patch: MemoryPatch) => void;
    getPath: (nodeId: string | null) => MessageNode[];
    setApiKey: (key: string) => void;
    setSessionTitle: (title: string) => void;
    setSessionIntent: (intent: SessionIntent) => void;
    setProviderId: (providerId: ProviderId) => void;
    setImageModelId: (imageModelId: string) => void;
    setImageOutputCount: (imageOutputCount: number) => void;
    goToParent: () => void;
    goToLatestChild: () => void;
    nextSibling: () => void;
    prevSibling: () => void;
    goToRoot: () => void;
}

function createEmptySessionState() {
    const now = new Date().toISOString();
    return {
        nodes: {},
        artifacts: {},
        groups: {},
        uiPositions: {},
        canvasPrunedNodeIds: [],
        compactions: {},
        rootId: null,
        activeNodeId: null,
        sessionTitle: undefined,
        sessionIntent: 'ask' as SessionIntent,
        providerId: 'gemini' as ProviderId,
        imageModelId: DEFAULT_IMAGE_MODEL_ID,
        imageOutputCount: DEFAULT_IMAGEN_OUTPUT_COUNT,
        importEnvelope: undefined,
        previewNodes: null,
        previewImportEnvelope: null,
        lastImportApplySnapshot: null,
        sessionId: crypto.randomUUID(),
        createdAt: now,
    };
}

function areNodeSelectionsEqual(left: string[], right: string[]) {
    if (left.length !== right.length) {
        return false;
    }

    const normalizedLeft = [...left].sort();
    const normalizedRight = [...right].sort();
    return normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

function collectNodeSubtreeIds(nodes: Record<string, MessageNode>, rootIds: string[]): Set<string> {
    const childIdsByParentId = new Map<string, string[]>();
    for (const node of Object.values(nodes)) {
        const parentIds = node.parentIds && node.parentIds.length > 0
            ? node.parentIds
            : node.parentId
                ? [node.parentId]
                : [];

        for (const parentId of parentIds) {
            const childIds = childIdsByParentId.get(parentId) ?? [];
            childIds.push(node.id);
            childIdsByParentId.set(parentId, childIds);
        }
    }

    const collected = new Set<string>();
    const queue = rootIds.filter((id) => nodes[id]);
    while (queue.length > 0) {
        const id = queue.shift();
        if (!id || collected.has(id)) {
            continue;
        }
        collected.add(id);
        queue.push(...(childIdsByParentId.get(id) ?? []));
    }

    return collected;
}

function getNearestVisibleNodeId(
    nodes: Record<string, MessageNode>,
    activeNodeId: string | null,
    rootId: string | null,
    hiddenNodeIds: Set<string>,
): string | null {
    let cursor = activeNodeId;
    while (cursor) {
        const node = nodes[cursor];
        if (!node) {
            break;
        }

        if (!hiddenNodeIds.has(cursor)) {
            return cursor;
        }

        cursor = node.parentId;
    }

    if (rootId && nodes[rootId] && !hiddenNodeIds.has(rootId)) {
        return rootId;
    }

    return Object.keys(nodes).find((id) => !hiddenNodeIds.has(id)) ?? null;
}

function updateSuggestionStatus(
    suggestions: StructureSuggestion[] | undefined,
    suggestionId: string,
    status: 'accepted' | 'rejected' | 'pending',
) {
    return (suggestions ?? []).map((suggestion) =>
        suggestion.id === suggestionId
            ? { ...suggestion, status }
            : suggestion,
    );
}

function buildAppliedImportState(
    state: Pick<GraphState, 'nodes' | 'importEnvelope'>,
    suggestions: StructureSuggestion[],
): Pick<GraphState, 'nodes' | 'importEnvelope'> {
    const { nodes, appliedSuggestionCount } = applyAcceptedStructureSuggestions(
        state.nodes,
        suggestions,
    );
    const importMode: ImportMode = appliedSuggestionCount > 0 ? 'assisted' : 'linear';

    return {
        nodes,
        importEnvelope: state.importEnvelope
            ? {
                ...state.importEnvelope,
                suggestions,
                importMode,
            }
            : undefined,
    };
}

function buildPreviewImportState(
    state: Pick<GraphState, 'nodes' | 'importEnvelope'>,
    suggestions: StructureSuggestion[],
) {
    const applied = buildAppliedImportState(state, suggestions);
    return {
        previewNodes: applied.nodes,
        previewImportEnvelope: applied.importEnvelope ?? null,
    };
}

function estimateBase64Size(data?: string): number | undefined {
    return data ? Math.floor(data.length * 0.75) : undefined;
}

function createImageArtifactRecordFromAttachment(
    attachment: AttachmentPart,
    nodeId: string,
    timestamp: string,
): { attachment: AttachmentPart; artifact: ImageFileArtifact } {
    const artifactId = attachment.artifactId ?? crypto.randomUUID();
    const name = attachment.name ?? buildImageArtifactFileName(artifactId, attachment.mimeType as ImageFileArtifact['mimeType']);
    const path = attachment.artifactPath ?? buildImageArtifactPath(artifactId, name);
    const url = attachment.url ?? buildImageArtifactUrl(artifactId, name);

    return {
        attachment: {
            ...attachment,
            artifactId,
            artifactPath: path,
            url,
            name,
        },
        artifact: {
            id: artifactId,
            kind: 'image',
            path,
            url,
            mimeType: attachment.mimeType as ImageFileArtifact['mimeType'],
            data: attachment.data,
            name,
            sizeBytes: attachment.sizeBytes ?? estimateBase64Size(attachment.data),
            origin: attachment.sourceType === 'generated' ? 'generated' : 'upload',
            createdAt: timestamp,
            sourceNodeId: nodeId,
            sourceAttachmentId: attachment.id,
        },
    };
}

function createImageArtifactRecordFromEvent(
    event: Extract<ChatEvent, { kind: 'image_artifact' }>,
    nodeId: string,
    timestamp: string,
): { event: ChatEvent; artifact: ImageFileArtifact } {
    const artifactId = event.artifact.artifactId ?? event.artifact.id;
    const name = buildImageArtifactFileName(artifactId, event.artifact.mimeType, event.artifact.label);
    const path = event.artifact.artifactPath ?? buildImageArtifactPath(artifactId, name);
    const url = event.artifact.url ?? buildImageArtifactUrl(artifactId, name);

    return {
        event: {
            ...event,
            artifact: {
                ...event.artifact,
                artifactId,
                artifactPath: path,
                url,
            },
        },
        artifact: {
            id: artifactId,
            kind: 'image',
            path,
            url,
            mimeType: event.artifact.mimeType,
            data: event.artifact.data,
            name,
            sizeBytes: estimateBase64Size(event.artifact.data),
            origin: 'generated',
            createdAt: timestamp,
            sourceNodeId: nodeId,
            sourceEventId: event.artifact.id,
            model: event.artifact.model,
            label: event.artifact.label,
        },
    };
}

function attachImageFileArtifactsToNode(
    node: MessageNode,
    existingArtifacts: Record<string, ImageFileArtifact>,
): { node: MessageNode; artifacts: Record<string, ImageFileArtifact> } {
    let nextNode = node;
    const artifacts: Record<string, ImageFileArtifact> = {};

    if ((node.attachments?.length ?? 0) > 0) {
        const attachments = node.attachments!.map((attachment) => {
            if (attachment.kind !== 'image') {
                return attachment;
            }

            const result = createImageArtifactRecordFromAttachment(attachment, node.id, node.timestamp);
            if (!existingArtifacts[result.artifact.id] && !artifacts[result.artifact.id]) {
                artifacts[result.artifact.id] = result.artifact;
            }
            return result.attachment;
        });
        nextNode = { ...nextNode, attachments };
    }

    if ((node.events?.length ?? 0) > 0) {
        const events = node.events!.map((event) => {
            if (event.kind !== 'image_artifact') {
                return event;
            }

            const result = createImageArtifactRecordFromEvent(event, node.id, node.timestamp);
            if (!existingArtifacts[result.artifact.id] && !artifacts[result.artifact.id]) {
                artifacts[result.artifact.id] = result.artifact;
            }
            return result.event;
        });
        nextNode = { ...nextNode, events };
    }

    return { node: nextNode, artifacts };
}

function applyStorageUpdatesToNode(
    node: MessageNode,
    updates: Map<string, ImageArtifactStorageUpdate>,
): MessageNode {
    let nextNode = node;

    if ((node.attachments?.length ?? 0) > 0) {
        const attachments = node.attachments!.map((attachment) => {
            const artifactId = attachment.artifactId;
            const update = artifactId ? updates.get(artifactId) : undefined;
            if (!update) {
                return attachment;
            }

            return {
                ...attachment,
                artifactPath: update.path,
                url: update.url,
                sizeBytes: update.sizeBytes ?? attachment.sizeBytes,
                data: undefined,
            };
        });
        nextNode = { ...nextNode, attachments };
    }

    if ((node.events?.length ?? 0) > 0) {
        const events = node.events!.map((event) => {
            if (event.kind !== 'image_artifact') {
                return event;
            }

            const artifactId = event.artifact.artifactId ?? event.artifact.id;
            const update = updates.get(artifactId);
            if (!update) {
                return event;
            }

            return {
                ...event,
                artifact: {
                    ...event.artifact,
                    artifactId,
                    artifactPath: update.path,
                    url: update.url,
                    data: undefined,
                },
            };
        });
        nextNode = { ...nextNode, events };
    }

    return nextNode;
}

export const useGraphStore = create<GraphState>((set, get) => ({
    ...createEmptySessionState(),
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
    isHydrated: false,
    isSaving: false,
    lastSavedAt: null,
    saveError: null,
    selectedNodeIds: [],
    canvasSelectedArtifactIds: [],
    canvasSelectedArtifactUse: 'edit_target',

    hydrateSession: async () => {
        const savedSession = await loadLastSession();

        if (savedSession) {
            set({
                ...savedSession.graph,
                artifacts: savedSession.graph.artifacts ?? {},
                groups: savedSession.graph.groups ?? {},
                uiPositions: savedSession.graph.uiPositions ?? {},
                canvasPrunedNodeIds: savedSession.graph.canvasPrunedNodeIds ?? [],
                compactions: savedSession.graph.compactions ?? {},
                sessionTitle: savedSession.graph.sessionTitle ?? savedSession.title,
                sessionIntent: savedSession.graph.sessionIntent ?? 'ask',
                providerId: savedSession.graph.providerId ?? 'gemini',
                imageModelId: savedSession.graph.imageModelId ?? DEFAULT_IMAGE_MODEL_ID,
                imageOutputCount: savedSession.graph.imageOutputCount ?? DEFAULT_IMAGEN_OUTPUT_COUNT,
                sessionId: savedSession.id,
                createdAt: savedSession.createdAt,
                apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
                isHydrated: true,
                isSaving: false,
                lastSavedAt: savedSession.updatedAt,
                saveError: null,
                canvasSelectedArtifactIds: [],
                canvasSelectedArtifactUse: 'edit_target',
                previewNodes: null,
                previewImportEnvelope: null,
                lastImportApplySnapshot: null,
            });
            return;
        }

        const emptyState = createEmptySessionState();
        set({
            ...emptyState,
            apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
            isHydrated: true,
            isSaving: false,
            lastSavedAt: null,
            saveError: null,
            canvasSelectedArtifactIds: [],
            canvasSelectedArtifactUse: 'edit_target',
            previewNodes: null,
            previewImportEnvelope: null,
            lastImportApplySnapshot: null,
        });
    },

    createNewSession: () => {
        const emptyState = createEmptySessionState();
        set({
            ...emptyState,
            apiKey: get().apiKey,
            sessionTitle: undefined,
            providerId: get().providerId,
            imageModelId: get().imageModelId,
            imageOutputCount: get().imageOutputCount,
            isHydrated: true,
            isSaving: false,
            lastSavedAt: null,
            saveError: null,
            selectedNodeIds: [],
            canvasSelectedArtifactIds: [],
            canvasSelectedArtifactUse: 'edit_target',
        });
    },

    loadSessionById: async (sessionId) => {
        const savedSession = await loadSession(sessionId);
        if (!savedSession) {
            return;
        }

        await markLastSession(savedSession.id);

        set({
            ...savedSession.graph,
            artifacts: savedSession.graph.artifacts ?? {},
            groups: savedSession.graph.groups ?? {},
            uiPositions: savedSession.graph.uiPositions ?? {},
            canvasPrunedNodeIds: savedSession.graph.canvasPrunedNodeIds ?? [],
                compactions: savedSession.graph.compactions ?? {},
                sessionTitle: savedSession.graph.sessionTitle ?? savedSession.title,
                sessionIntent: savedSession.graph.sessionIntent ?? 'ask',
                providerId: savedSession.graph.providerId ?? 'gemini',
            imageModelId: savedSession.graph.imageModelId ?? DEFAULT_IMAGE_MODEL_ID,
            imageOutputCount: savedSession.graph.imageOutputCount ?? DEFAULT_IMAGEN_OUTPUT_COUNT,
            sessionId: savedSession.id,
            createdAt: savedSession.createdAt,
            apiKey: get().apiKey,
            isHydrated: true,
            isSaving: false,
            lastSavedAt: savedSession.updatedAt,
            saveError: null,
            selectedNodeIds: [],
            canvasSelectedArtifactIds: [],
            canvasSelectedArtifactUse: 'edit_target',
            previewNodes: null,
            previewImportEnvelope: null,
            lastImportApplySnapshot: null,
        });
    },

    loadSessionFromData: async (session) => {
        const validatedSession = validatePersistedSession(session);
        await markLastSession(validatedSession.id);
        set({
            ...validatedSession.graph,
            artifacts: validatedSession.graph.artifacts ?? {},
            groups: validatedSession.graph.groups ?? {},
            uiPositions: validatedSession.graph.uiPositions ?? {},
            canvasPrunedNodeIds: validatedSession.graph.canvasPrunedNodeIds ?? [],
                compactions: validatedSession.graph.compactions ?? {},
                sessionTitle: validatedSession.graph.sessionTitle ?? validatedSession.title,
                sessionIntent: validatedSession.graph.sessionIntent ?? 'ask',
                providerId: validatedSession.graph.providerId ?? 'gemini',
            imageModelId: validatedSession.graph.imageModelId ?? DEFAULT_IMAGE_MODEL_ID,
            imageOutputCount: validatedSession.graph.imageOutputCount ?? DEFAULT_IMAGEN_OUTPUT_COUNT,
            sessionId: validatedSession.id,
            createdAt: validatedSession.createdAt,
            apiKey: get().apiKey,
            isHydrated: true,
            isSaving: false,
            lastSavedAt: validatedSession.updatedAt,
            saveError: null,
            selectedNodeIds: [],
            canvasSelectedArtifactIds: [],
            canvasSelectedArtifactUse: 'edit_target',
            previewNodes: null,
            previewImportEnvelope: null,
            lastImportApplySnapshot: null,
        });
    },

    importLinearTranscript: ({ sourcePlatform, turns, sourceConversationId, parserConfidence, importWarnings }) => {
        const filteredTurns = sanitizeImportedTurns(turns);
        const importedAt = new Date().toISOString();
        const sessionId = crypto.randomUUID();
        const createdAt = importedAt;
        const suggestions = inferStructureRules(filteredTurns).map((suggestion) => ({
            ...suggestion,
            status: 'pending' as const,
        }));

        if (filteredTurns.length === 0) {
            return null;
        }

        const nodes: Record<string, MessageNode> = {};
        let previousNodeId: string | null = null;
        let rootId: string | null = null;

        filteredTurns.forEach((turn, index) => {
            const nodeId = crypto.randomUUID();
            const timestamp = turn.timestamp ?? importedAt;

            nodes[nodeId] = {
                id: nodeId,
                parentId: previousNodeId,
                role: turn.role,
                content: turn.text,
                memoryPatches: [],
                timestamp,
                summary: turn.text.length > 40 ? `${turn.text.slice(0, 40)}...` : turn.text,
                importMetadata: {
                    origin: 'imported',
                    sourcePlatform,
                    sourceTurnId: turn.sourceTurnId,
                    sourceTurnIndex: index,
                    importedAt,
                },
            };

            if (!rootId) {
                rootId = nodeId;
            }

            previousNodeId = nodeId;
        });

        set({
            nodes,
            artifacts: {},
            groups: {},
            uiPositions: {},
            canvasPrunedNodeIds: [],
            compactions: {},
            providerId: get().providerId,
            sessionIntent: 'ask',
            imageModelId: get().imageModelId,
            imageOutputCount: get().imageOutputCount,
            rootId,
            activeNodeId: previousNodeId,
            importEnvelope: {
                sourcePlatform,
                importMode: 'linear',
                importedAt,
                messageCount: filteredTurns.length,
                sourceConversationId,
                parserConfidence,
                importWarnings,
                suggestions,
                hiddenContext: {
                    visibleTranscriptOnly: true,
                    possibleAccountMemory: sourcePlatform === 'chatgpt' || sourcePlatform === 'claude' || sourcePlatform === 'gemini',
                    possibleProjectMemory: sourcePlatform === 'chatgpt' || sourcePlatform === 'claude',
                    possibleRetrieval: sourcePlatform === 'claude' || sourcePlatform === 'gemini',
                    possibleConnectedAppContext: sourcePlatform === 'gemini',
                    unknownHiddenContext: true,
                    notes: ['Imported from a visible transcript only. Hidden vendor memory may not be represented.'],
                },
            },
            sessionId,
            createdAt,
            apiKey: get().apiKey,
            isHydrated: true,
            isSaving: false,
            lastSavedAt: null,
            saveError: null,
            selectedNodeIds: [],
            canvasSelectedArtifactIds: [],
            canvasSelectedArtifactUse: 'edit_target',
            previewNodes: null,
            previewImportEnvelope: null,
            lastImportApplySnapshot: null,
        });

        return previousNodeId;
    },

    updateImportSuggestionStatus: (suggestionId, status) => set((state) => {
        if (!state.importEnvelope) {
            return state;
        }

        const suggestions = updateSuggestionStatus(state.importEnvelope.suggestions, suggestionId, status);

        return {
            importEnvelope: {
                ...state.importEnvelope,
                suggestions,
            },
        };
    }),

    applyHighConfidenceImportSuggestions: () => set((state) => {
        if (!state.importEnvelope) {
            return state;
        }

        const suggestions = (state.importEnvelope.suggestions ?? []).map((suggestion) =>
            suggestion.confidence === 'high'
                ? { ...suggestion, status: 'accepted' as const }
                : suggestion,
        );

        return {
            importEnvelope: {
                ...state.importEnvelope,
                suggestions,
            },
        };
    }),

    applyAcceptedImportSuggestions: () => {
        const state = get();
        if (!state.importEnvelope) {
            return 0;
        }

        const suggestions = (state.previewImportEnvelope ?? state.importEnvelope)?.suggestions ?? [];
        return get().commitImportSuggestions(suggestions);
    },

    commitImportSuggestions: (suggestions) => {
        const state = get();
        if (!state.importEnvelope) {
            return 0;
        }

        const nextState = buildAppliedImportState(
            {
                nodes: state.nodes,
                importEnvelope: state.importEnvelope,
            },
            suggestions,
        );
        const appliedSuggestionCount = suggestions.filter((suggestion) => suggestion.status === 'accepted').length;

        set({
            ...nextState,
            previewNodes: null,
            previewImportEnvelope: null,
            lastImportApplySnapshot: {
                nodes: state.nodes,
                importEnvelope: state.importEnvelope,
                uiPositions: state.uiPositions,
            },
        });

        return appliedSuggestionCount;
    },

    previewImportSuggestions: (suggestions) => set((state) => {
        if (!state.importEnvelope) {
            return state;
        }

        return buildPreviewImportState(state, suggestions);
    }),

    clearImportPreview: () => set({
        previewNodes: null,
        previewImportEnvelope: null,
    }),

    undoLastImportApply: () => set((state) => {
        if (!state.lastImportApplySnapshot) {
            return state;
        }

        return {
            nodes: state.lastImportApplySnapshot.nodes,
            importEnvelope: state.lastImportApplySnapshot.importEnvelope,
            uiPositions: state.lastImportApplySnapshot.uiPositions,
            previewNodes: null,
            previewImportEnvelope: null,
            lastImportApplySnapshot: null,
        };
    }),

    addCompaction: (block) => set((state) => {
        const nextNodeIds = new Set(block.nodeIds);
        const preserved = Object.fromEntries(
            Object.entries(state.compactions).filter(([, existing]) =>
                !existing.nodeIds.some((id) => nextNodeIds.has(id)),
            ),
        );
        return {
            compactions: {
                ...preserved,
                [block.id]: block,
            },
        };
    }),

    removeCompaction: (id) => set((state) => {
        const rest = { ...state.compactions };
        delete rest[id];
        return { compactions: rest };
    }),

    toggleNodeSelection: (id) => set((state) => {
        const exists = state.selectedNodeIds.includes(id);
        if (exists) {
            return {
                selectedNodeIds: state.selectedNodeIds.filter((selectedId) => selectedId !== id),
            };
        }

        return { selectedNodeIds: [...state.selectedNodeIds, id] };
    }),

    setSelectedNodeIds: (ids) => set((state) => {
        if (areNodeSelectionsEqual(state.selectedNodeIds, ids)) {
            return state;
        }

        return { selectedNodeIds: ids };
    }),

    clearNodeSelection: () => set({ selectedNodeIds: [] }),

    pruneCanvasNodes: (ids) => set((state) => {
        const nextPrunedRootIds = [...new Set([
            ...state.canvasPrunedNodeIds,
            ...ids.filter((id) => Boolean(state.nodes[id])),
        ])];
        const hiddenNodeIds = collectNodeSubtreeIds(state.nodes, nextPrunedRootIds);
        const activeNodeId = state.activeNodeId && hiddenNodeIds.has(state.activeNodeId)
            ? getNearestVisibleNodeId(state.nodes, state.activeNodeId, state.rootId, hiddenNodeIds)
            : state.activeNodeId;

        return {
            canvasPrunedNodeIds: nextPrunedRootIds,
            activeNodeId,
            selectedNodeIds: [],
        };
    }),

    restoreCanvasPruning: () => set({
        canvasPrunedNodeIds: [],
        selectedNodeIds: [],
    }),

    toggleCanvasArtifactSelection: (id) => set((state) => {
        const exists = state.canvasSelectedArtifactIds.includes(id);
        return {
            canvasSelectedArtifactIds: exists
                ? state.canvasSelectedArtifactIds.filter((artifactId) => artifactId !== id)
                : [...state.canvasSelectedArtifactIds, id],
        };
    }),

    setCanvasArtifactSelection: (ids, use) => set((state) => ({
        canvasSelectedArtifactIds: [...new Set(ids)],
        canvasSelectedArtifactUse: use ?? state.canvasSelectedArtifactUse,
    })),

    setCanvasArtifactSelectionUse: (canvasSelectedArtifactUse) => set({ canvasSelectedArtifactUse }),

    clearCanvasArtifactSelection: () => set({ canvasSelectedArtifactIds: [], canvasSelectedArtifactUse: 'edit_target' }),

    createGroup: (groupData) => {
        const id = crypto.randomUUID();
        const newGroup: ContextGroup = {
            ...groupData,
            id,
        };

        set((state) => {
            const nextNodes = { ...state.nodes };
            for (const nodeId of groupData.nodeIds) {
                const node = nextNodes[nodeId];
                if (!node) continue;
                const currentGroupIds = node.groupIds ?? [];
                if (!currentGroupIds.includes(id)) {
                    nextNodes[nodeId] = {
                        ...node,
                        groupIds: [...currentGroupIds, id],
                    };
                }
            }

            return {
                groups: {
                    ...state.groups,
                    [id]: newGroup,
                },
                nodes: nextNodes,
                selectedNodeIds: [],
            };
        });

        return id;
    },

    addNode: (nodeData) => {
        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const baseNode: MessageNode = {
            ...nodeData,
            id,
            timestamp,
        };

        set((state) => {
            const { node: newNode, artifacts } = attachImageFileArtifactsToNode(baseNode, state.artifacts);
            const isFirstNode = Object.keys(state.nodes).length === 0;
            return {
                nodes: { ...state.nodes, [id]: newNode },
                artifacts: { ...state.artifacts, ...artifacts },
                rootId: isFirstNode ? id : state.rootId,
                activeNodeId: id,
                selectedNodeIds: [],
                previewNodes: null,
                previewImportEnvelope: null,
            };
        });

        return id;
    },

    markImageArtifactsStored: (updates) => set((state) => {
        if (updates.length === 0) {
            return state;
        }

        const updateById = new Map(updates.map((update) => [update.artifactId, update]));
        const artifacts = { ...state.artifacts };
        let changed = false;

        for (const update of updates) {
            const artifact = artifacts[update.artifactId];
            if (!artifact) {
                continue;
            }
            artifacts[update.artifactId] = {
                ...artifact,
                path: update.path,
                url: update.url,
                sizeBytes: update.sizeBytes ?? artifact.sizeBytes,
                data: undefined,
            };
            changed = true;
        }

        if (!changed) {
            return state;
        }

        const nodes = Object.fromEntries(
            Object.entries(state.nodes).map(([id, node]) => [
                id,
                applyStorageUpdatesToNode(node, updateById),
            ]),
        );

        return { artifacts, nodes };
    }),

    setUiPosition: (id, position) => set((state) => ({
        uiPositions: {
            ...state.uiPositions,
            [id]: position,
        },
    })),

    setActiveNode: (id) => set({ activeNodeId: id }),
    setApiKey: (key) => set({ apiKey: key }),
    setSessionTitle: (sessionTitle) => set({ sessionTitle }),
    setSessionIntent: (sessionIntent) => set({ sessionIntent }),
    setProviderId: (providerId) => set({ providerId }),
    setImageModelId: (imageModelId) => set({ imageModelId }),
    setImageOutputCount: (imageOutputCount) => set({ imageOutputCount }),

    updateNodeSummary: (id, summary) => set((state) => {
        const node = state.nodes[id];
        if (!node) return state;
        return {
            nodes: {
                ...state.nodes,
                [id]: { ...node, summary },
            },
        };
    }),

    addMemoryPatch: (nodeId, patch) => set((state) => {
        const node = state.nodes[nodeId];
        if (!node) return state;
        return {
            nodes: {
                ...state.nodes,
                [nodeId]: {
                    ...node,
                    memoryPatches: [...node.memoryPatches, patch],
                },
            },
        };
    }),

    goToParent: () => set((state) => {
        if (!state.activeNodeId) return state;
        const currentNode = state.nodes[state.activeNodeId];
        if (!currentNode || !currentNode.parentId) return state;
        return { activeNodeId: currentNode.parentId };
    }),

    goToLatestChild: () => set((state) => {
        if (!state.activeNodeId) return state;
        const currentId = state.activeNodeId;
        const children = Object.values(state.nodes).filter(
            (node) => node.parentId === currentId,
        );

        if (children.length === 0) return state;

        const latestChild = children.reduce((latest, current) =>
            current.timestamp > latest.timestamp ? current : latest,
        );

        return { activeNodeId: latestChild.id };
    }),

    nextSibling: () => set((state) => {
        if (!state.activeNodeId) return state;
        const currentNode = state.nodes[state.activeNodeId];
        if (!currentNode || !currentNode.parentId) return state;

        const siblings = Object.values(state.nodes)
            .filter((node) => node.parentId === currentNode.parentId)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        if (siblings.length <= 1) return state;

        const currentIndex = siblings.findIndex((node) => node.id === state.activeNodeId);
        const nextIndex = (currentIndex + 1) % siblings.length;

        return { activeNodeId: siblings[nextIndex].id };
    }),

    prevSibling: () => set((state) => {
        if (!state.activeNodeId) return state;
        const currentNode = state.nodes[state.activeNodeId];
        if (!currentNode || !currentNode.parentId) return state;

        const siblings = Object.values(state.nodes)
            .filter((node) => node.parentId === currentNode.parentId)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        if (siblings.length <= 1) return state;

        const currentIndex = siblings.findIndex((node) => node.id === state.activeNodeId);
        const prevIndex = (currentIndex - 1 + siblings.length) % siblings.length;

        return { activeNodeId: siblings[prevIndex].id };
    }),

    goToRoot: () => set((state) => {
        if (!state.rootId) return state;
        return { activeNodeId: state.rootId };
    }),

    getPath: (nodeId) => {
        const { nodes, previewNodes } = get();
        const activeNodes = previewNodes ?? nodes;
        if (!nodeId) return [];

        const path: MessageNode[] = [];
        let currentId: string | null = nodeId;

        while (currentId && activeNodes[currentId]) {
            path.unshift(activeNodes[currentId]);
            currentId = activeNodes[currentId].parentId;
        }

        return path;
    },
}));

let lastSavedSnapshot = '';
let saveSequence = 0;

useGraphStore.subscribe((state) => {
    if (!state.isHydrated) {
        return;
    }

    const snapshot = JSON.stringify({
        sessionId: state.sessionId,
        nodes: state.nodes,
        artifacts: state.artifacts,
        groups: state.groups,
        uiPositions: state.uiPositions,
        canvasPrunedNodeIds: state.canvasPrunedNodeIds,
        compactions: state.compactions,
        sessionTitle: state.sessionTitle,
        sessionIntent: state.sessionIntent,
        providerId: state.providerId,
        imageModelId: state.imageModelId,
        imageOutputCount: state.imageOutputCount,
        rootId: state.rootId,
        activeNodeId: state.activeNodeId,
        importEnvelope: state.importEnvelope,
    });

    if (snapshot === lastSavedSnapshot) {
        return;
    }

    lastSavedSnapshot = snapshot;
    const updatedAt = new Date().toISOString();
    const sequence = ++saveSequence;

    useGraphStore.setState({
        isSaving: true,
        saveError: null,
    });

    void saveSession({
        id: state.sessionId,
        createdAt: state.createdAt,
        updatedAt,
        title: state.sessionTitle?.trim() || deriveSessionTitle({
            nodes: state.nodes,
            artifacts: state.artifacts,
            groups: state.groups,
            uiPositions: state.uiPositions,
            canvasPrunedNodeIds: state.canvasPrunedNodeIds,
            compactions: state.compactions,
            sessionTitle: state.sessionTitle,
            sessionIntent: state.sessionIntent,
            providerId: state.providerId,
            imageModelId: state.imageModelId,
            imageOutputCount: state.imageOutputCount,
            rootId: state.rootId,
            activeNodeId: state.activeNodeId,
            importEnvelope: state.importEnvelope,
        }),
        graph: {
            nodes: state.nodes,
            artifacts: state.artifacts,
            groups: state.groups,
            uiPositions: state.uiPositions,
            canvasPrunedNodeIds: state.canvasPrunedNodeIds,
            compactions: state.compactions,
            sessionTitle: state.sessionTitle,
            sessionIntent: state.sessionIntent,
            providerId: state.providerId,
            imageModelId: state.imageModelId,
            imageOutputCount: state.imageOutputCount,
            rootId: state.rootId,
            activeNodeId: state.activeNodeId,
            importEnvelope: state.importEnvelope,
        },
    }).then(() => {
        if (sequence !== saveSequence) {
            return;
        }
        useGraphStore.setState({
            isSaving: false,
            lastSavedAt: updatedAt,
            saveError: null,
        });
    }).catch((error) => {
        if (sequence !== saveSequence) {
            return;
        }
        console.error('MemoTree session autosave failed:', error);
        useGraphStore.setState({
            isSaving: false,
            saveError: error instanceof Error ? error.message : 'Autosave failed.',
        });
    });
});
