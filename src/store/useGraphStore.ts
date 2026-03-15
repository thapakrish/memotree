import { create } from 'zustand';
import type { MessageNode, ConversationGraph, MemoryPatch } from './types';
import { deriveSessionTitle, loadLastSession, loadSession, markLastSession, saveSession } from '../lib/sessionPersistence';

interface GraphState extends ConversationGraph {
    sessionId: string;
    createdAt: string;
    isHydrated: boolean;
    mergeSelectionIds: string[];
    hydrateSession: () => Promise<void>;
    createNewSession: () => void;
    loadSessionById: (sessionId: string) => Promise<void>;
    toggleMergeSelection: (id: string) => void;
    clearMergeSelection: () => void;
    addNode: (node: Omit<MessageNode, 'id' | 'timestamp'>) => string;
    setActiveNode: (id: string | null) => void;
    updateNodeSummary: (id: string, summary: string) => void;
    addMemoryPatch: (nodeId: string, patch: MemoryPatch) => void;
    getPath: (nodeId: string | null) => MessageNode[];
    setApiKey: (key: string) => void;
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
        rootId: null,
        activeNodeId: null,
        sessionId: crypto.randomUUID(),
        createdAt: now,
    };
}

export const useGraphStore = create<GraphState>((set, get) => ({
    ...createEmptySessionState(),
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
    isHydrated: false,
    mergeSelectionIds: [],

    hydrateSession: async () => {
        const savedSession = await loadLastSession();

        if (savedSession) {
            set({
                ...savedSession.graph,
                sessionId: savedSession.id,
                createdAt: savedSession.createdAt,
                apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
                isHydrated: true,
            });
            return;
        }

        const emptyState = createEmptySessionState();
        set({
            ...emptyState,
            apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,
            isHydrated: true,
        });
    },

    createNewSession: () => {
        const emptyState = createEmptySessionState();
        set({
            ...emptyState,
            apiKey: get().apiKey,
            isHydrated: true,
            mergeSelectionIds: [],
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
            sessionId: savedSession.id,
            createdAt: savedSession.createdAt,
            apiKey: get().apiKey,
            isHydrated: true,
            mergeSelectionIds: [],
        });
    },

    toggleMergeSelection: (id) => set((state) => {
        const exists = state.mergeSelectionIds.includes(id);
        if (exists) {
            return {
                mergeSelectionIds: state.mergeSelectionIds.filter((selectedId) => selectedId !== id),
            };
        }

        const nextIds = [...state.mergeSelectionIds, id].slice(-2);
        return { mergeSelectionIds: nextIds };
    }),

    clearMergeSelection: () => set({ mergeSelectionIds: [] }),

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
                mergeSelectionIds: [],
            };
        });

        return id;
    },

    setActiveNode: (id) => set({ activeNodeId: id }),
    setApiKey: (key) => set({ apiKey: key }),

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
        const { nodes } = get();
        if (!nodeId) return [];

        const path: MessageNode[] = [];
        let currentId: string | null = nodeId;

        while (currentId && nodes[currentId]) {
            path.unshift(nodes[currentId]);
            currentId = nodes[currentId].parentId;
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
        rootId: state.rootId,
        activeNodeId: state.activeNodeId,
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
            rootId: state.rootId,
            activeNodeId: state.activeNodeId,
        }),
        graph: {
            nodes: state.nodes,
            rootId: state.rootId,
            activeNodeId: state.activeNodeId,
        },
    });
});
