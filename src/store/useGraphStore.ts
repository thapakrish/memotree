import { create } from 'zustand';
import type { ProviderId } from '../lib/providers';
import type {
    CompactionBlock,
    ContextGroup,
    ImportedTurn,
    ImportSourcePlatform,
    ImportMode,
    MessageNode,
    ConversationGraph,
    MemoryPatch,
    StructureSuggestion,
} from './types';
import { deriveSessionTitle, loadLastSession, loadSession, markLastSession, saveSession } from '../lib/sessionPersistence';
import { applyAcceptedStructureSuggestions } from '../lib/import/applyStructureSuggestions';
import { inferStructureRules } from '../lib/import/inferStructureRules';
import { sanitizeImportedTurns } from '../lib/import/validateImportedTurns';

interface GraphState extends ConversationGraph {
    sessionId: string;
    createdAt: string;
    isHydrated: boolean;
    selectedNodeIds: string[];
    previewNodes: Record<string, MessageNode> | null;
    previewImportEnvelope: GraphState['importEnvelope'] | null;
    lastImportApplySnapshot: Pick<ConversationGraph, 'nodes' | 'importEnvelope' | 'uiPositions'> | null;
    hydrateSession: () => Promise<void>;
    createNewSession: () => void;
    loadSessionById: (sessionId: string) => Promise<void>;
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
    addCompaction: (block: CompactionBlock) => void;
    removeCompaction: (id: string) => void;
    createGroup: (group: Omit<ContextGroup, 'id'>) => string;
    addNode: (node: Omit<MessageNode, 'id' | 'timestamp'>) => string;
    setUiPosition: (id: string, position: { x: number; y: number }) => void;
    setActiveNode: (id: string | null) => void;
    updateNodeSummary: (id: string, summary: string) => void;
    addMemoryPatch: (nodeId: string, patch: MemoryPatch) => void;
    getPath: (nodeId: string | null) => MessageNode[];
    setApiKey: (key: string) => void;
    setProviderId: (providerId: ProviderId) => void;
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
        groups: {},
        uiPositions: {},
        compactions: {},
        rootId: null,
        activeNodeId: null,
        providerId: 'gemini' as ProviderId,
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

export const useGraphStore = create<GraphState>((set, get) => ({
    ...createEmptySessionState(),
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
    isHydrated: false,
    selectedNodeIds: [],

    hydrateSession: async () => {
        const savedSession = await loadLastSession();

        if (savedSession) {
            set({
                ...savedSession.graph,
                groups: savedSession.graph.groups ?? {},
                uiPositions: savedSession.graph.uiPositions ?? {},
                compactions: savedSession.graph.compactions ?? {},
                providerId: savedSession.graph.providerId ?? 'gemini',
                sessionId: savedSession.id,
                createdAt: savedSession.createdAt,
                apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
                isHydrated: true,
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
            providerId: get().providerId,
            isHydrated: true,
            selectedNodeIds: [],
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
            groups: savedSession.graph.groups ?? {},
            uiPositions: savedSession.graph.uiPositions ?? {},
            compactions: savedSession.graph.compactions ?? {},
            providerId: savedSession.graph.providerId ?? 'gemini',
            sessionId: savedSession.id,
            createdAt: savedSession.createdAt,
            apiKey: get().apiKey,
            isHydrated: true,
            selectedNodeIds: [],
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
            groups: {},
            uiPositions: {},
            compactions: {},
            providerId: get().providerId,
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
            selectedNodeIds: [],
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
        const newNode: MessageNode = {
            ...nodeData,
            id,
            timestamp,
        };

        set((state) => {
            const isFirstNode = Object.keys(state.nodes).length === 0;
            return {
                nodes: { ...state.nodes, [id]: newNode },
                rootId: isFirstNode ? id : state.rootId,
                activeNodeId: id,
                selectedNodeIds: [],
                previewNodes: null,
                previewImportEnvelope: null,
            };
        });

        return id;
    },

    setUiPosition: (id, position) => set((state) => ({
        uiPositions: {
            ...state.uiPositions,
            [id]: position,
        },
    })),

    setActiveNode: (id) => set({ activeNodeId: id }),
    setApiKey: (key) => set({ apiKey: key }),
    setProviderId: (providerId) => set({ providerId }),

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

useGraphStore.subscribe((state) => {
    if (!state.isHydrated) {
        return;
    }

    const snapshot = JSON.stringify({
        sessionId: state.sessionId,
        nodes: state.nodes,
        groups: state.groups,
        uiPositions: state.uiPositions,
        compactions: state.compactions,
        providerId: state.providerId,
        rootId: state.rootId,
        activeNodeId: state.activeNodeId,
        importEnvelope: state.importEnvelope,
    });

    if (snapshot === lastSavedSnapshot) {
        return;
    }

    lastSavedSnapshot = snapshot;

    void saveSession({
        id: state.sessionId,
        createdAt: state.createdAt,
        updatedAt: new Date().toISOString(),
        title: deriveSessionTitle({
            nodes: state.nodes,
            groups: state.groups,
            uiPositions: state.uiPositions,
            compactions: state.compactions,
            providerId: state.providerId,
            rootId: state.rootId,
            activeNodeId: state.activeNodeId,
            importEnvelope: state.importEnvelope,
        }),
        graph: {
            nodes: state.nodes,
            groups: state.groups,
            uiPositions: state.uiPositions,
            compactions: state.compactions,
            providerId: state.providerId,
            rootId: state.rootId,
            activeNodeId: state.activeNodeId,
            importEnvelope: state.importEnvelope,
        },
    });
});
