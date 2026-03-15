import React, { useCallback, useEffect, useState } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    useReactFlow,
    type Node,
    type Edge,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { GitMerge } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import { CustomNode } from './CustomNode';
import { getLayoutedElements } from '../lib/layout';
import { MergeBranchesModal } from './MergeBranchesModal';
import { buildGeminiContents, generateGeminiResponseStreamFromContents, getAssistantText } from '../lib/geminiEngine';
import { buildMergeContext, buildMergeRequestContents, isMergeableAssistant } from '../lib/mergeContext';
import { getNodeSummary, mergeEvents } from '../lib/chatEvents';
import type { ChatEvent, MergeContextMode } from '../store/types';
import { reconstructMemory } from '../lib/memoryEngine';

const nodeTypes = {
    custom: CustomNode,
};

export function GraphView() {
    const {
        nodes: storeNodes,
        activeNodeId,
        apiKey,
        mergeSelectionIds,
        setActiveNode,
        toggleMergeSelection,
        clearMergeSelection,
        addNode,
    } = useGraphStore();

    const [rfNodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const { setCenter } = useReactFlow();

    useEffect(() => {
        const rawNodes: Node[] = [];
        const rawEdges: Edge[] = [];

        Object.values(storeNodes).forEach((node) => {
            rawNodes.push({
                id: node.id,
                type: 'custom',
                position: { x: 0, y: 0 },
                data: {
                    node,
                    isActive: node.id === activeNodeId,
                    isSelected: mergeSelectionIds.includes(node.id),
                },
            });

            const parentEdgeIds = node.parentIds && node.parentIds.length > 0
                ? node.parentIds
                : node.parentId
                    ? [node.parentId]
                    : [];

            parentEdgeIds.forEach((parentId) => {
                rawEdges.push({
                    id: `e-${parentId}-${node.id}`,
                    source: parentId,
                    target: node.id,
                    type: 'smoothstep',
                    animated: node.id === activeNodeId,
                    style: {
                        stroke: node.id === activeNodeId ? '#3b82f6' : '#cbd5e1',
                        strokeWidth: node.id === activeNodeId ? 3 : 2,
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: node.id === activeNodeId ? '#3b82f6' : '#cbd5e1',
                    },
                });
            });
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [storeNodes, activeNodeId, mergeSelectionIds, setNodes, setEdges]);

    useEffect(() => {
        if (activeNodeId && rfNodes.length > 0) {
            const activeNode = rfNodes.find((node) => node.id === activeNodeId);
            if (activeNode) {
                const x = activeNode.position.x + 125;
                const y = activeNode.position.y + 50;
                setCenter(x, y, { zoom: 1, duration: 800 });
            }
        }
    }, [activeNodeId, rfNodes, setCenter]);

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            toggleMergeSelection(node.id);
            return;
        }

        setActiveNode(node.id);
    }, [setActiveNode, toggleMergeSelection]);

    const selectedNodes = mergeSelectionIds
        .map((id) => storeNodes[id])
        .filter(Boolean);
    const canMergeSelected = selectedNodes.length === 2 && selectedNodes.every(isMergeableAssistant) && !!apiKey;

    const handleMergeSubmit = async (instruction: string, mode: MergeContextMode) => {
        if (!apiKey || selectedNodes.length !== 2) {
            return;
        }

        const leftNode = selectedNodes[0];
        const rightNode = selectedNodes[1];
        if (!leftNode || !rightNode) {
            return;
        }

        setIsMerging(true);

        try {
            const { mergeContext, commonPath, commonAncestorId } = buildMergeContext(
                storeNodes,
                [leftNode.id, rightNode.id],
                instruction,
                mode,
            );

            const commonPathContents = buildGeminiContents(commonPath);
            const mergeRequestContents = buildMergeRequestContents(
                mergeContext,
                commonPathContents,
            );

            const memoryState = reconstructMemory(commonPath);
            const stream = await generateGeminiResponseStreamFromContents(
                mergeRequestContents,
                memoryState,
                apiKey,
            );

            let events: ChatEvent[] = [];
            for await (const chunk of stream) {
                events = mergeEvents(events, chunk.candidates?.[0]?.content?.parts
                    ? chunk.candidates[0].content.parts.flatMap<ChatEvent>((part) => {
                        if (!part.text) return [];
                        return part.thought
                            ? [{ kind: 'thought', text: part.text, signature: part.thoughtSignature, tokenCount: chunk.usageMetadata?.thoughtsTokenCount }]
                            : [{ kind: 'text', text: part.text }];
                    })
                    : []);
            }

            const assistantText = getAssistantText(events) || 'Merged branch created.';

            const mergeNodeId = addNode({
                parentId: commonAncestorId,
                parentIds: [leftNode.id, rightNode.id],
                kind: 'merge',
                role: 'assistant',
                content: assistantText,
                events,
                mergeContext,
                memoryPatches: [],
                summary: getNodeSummary({
                    role: 'assistant',
                    events,
                    content: assistantText,
                    kind: 'merge',
                    mergeContext,
                }),
            });

            setActiveNode(mergeNodeId);
            clearMergeSelection();
            setIsMergeModalOpen(false);
        } finally {
            setIsMerging(false);
        }
    };

    return (
        <div className="w-full h-full bg-slate-50 relative">
            <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
                <div className="font-semibold text-slate-700 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
                    Memory Tree Map
                </div>
                <button
                    onClick={() => setIsMergeModalOpen(true)}
                    disabled={!canMergeSelected}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-fuchsia-300 hover:bg-fuchsia-50 hover:text-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <GitMerge className="h-4 w-4" />
                    <span>Merge Selected</span>
                </button>
            </div>
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
            <MergeBranchesModal
                isOpen={isMergeModalOpen}
                leftNode={selectedNodes[0]}
                rightNode={selectedNodes[1]}
                isSubmitting={isMerging}
                onClose={() => setIsMergeModalOpen(false)}
                onSubmit={handleMergeSubmit}
            />
        </div>
    );
}
