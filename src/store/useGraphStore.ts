import { create } from 'zustand';
import type { MessageNode, ConversationGraph, MemoryPatch } from './types';

interface GraphState extends ConversationGraph {
    addNode: (node: Omit<MessageNode, 'id' | 'timestamp'>) => string;
    setActiveNode: (id: string | null) => void;
    updateNodeSummary: (id: string, summary: string) => void;
    addMemoryPatch: (nodeId: string, patch: MemoryPatch) => void;
    getPath: (nodeId: string | null) => MessageNode[];
    setApiKey: (key: string) => void;
    
    // Traversal Actions
    goToParent: () => void; // Undo
    goToLatestChild: () => void; // Redo (down main path)
    nextSibling: () => void; // Branch right
    prevSibling: () => void; // Branch left
    goToRoot: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
    nodes: {},
    rootId: null,
    activeNodeId: null,
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || null,

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
                activeNodeId: id, // Automatically switch to new node's timeline
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
                [id]: { ...node, summary }
            }
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
                    memoryPatches: [...node.memoryPatches, patch]
                }
            }
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
        
        // Find all children of the current node
        const children = Object.values(state.nodes).filter(
            n => n.parentId === currentId
        );
        
        if (children.length === 0) return state;

        // If there are multiple branches, pick the most recently created one
        // (timestamp string comparison works for ISO strings)
        const latestChild = children.reduce((latest, current) => 
            current.timestamp > latest.timestamp ? current : latest
        );

        return { activeNodeId: latestChild.id };
    }),

    nextSibling: () => set((state) => {
        if (!state.activeNodeId) return state;
        const currentNode = state.nodes[state.activeNodeId];
        if (!currentNode || !currentNode.parentId) return state;

        // Find all siblings (nodes sharing the same parent)
        const siblings = Object.values(state.nodes).filter(
            n => n.parentId === currentNode.parentId
        ).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        if (siblings.length <= 1) return state;

        const currentIndex = siblings.findIndex(n => n.id === state.activeNodeId);
        // Wrap around to the start (or conceptually 'branch right')
        const nextIndex = (currentIndex + 1) % siblings.length;
        
        return { activeNodeId: siblings[nextIndex].id };
    }),

    prevSibling: () => set((state) => {
        if (!state.activeNodeId) return state;
        const currentNode = state.nodes[state.activeNodeId];
        if (!currentNode || !currentNode.parentId) return state;

        // Find all siblings (nodes sharing the same parent)
        const siblings = Object.values(state.nodes).filter(
            n => n.parentId === currentNode.parentId
        ).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        if (siblings.length <= 1) return state;

        const currentIndex = siblings.findIndex(n => n.id === state.activeNodeId);
        // Wrap around backward (or conceptually 'branch left')
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

        return path; // Chronological path from root to node (Backward DAG Traversal reversed)
    }
}));
