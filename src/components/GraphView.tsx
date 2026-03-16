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
    SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { FolderTree, GitMerge, MousePointer2, SquareDashedMousePointer } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import { CustomNode } from './CustomNode';
import { getLayoutedElements } from '../lib/layout';
import { MergeBranchesModal } from './MergeBranchesModal';
import { GroupNodesModal } from './GroupNodesModal';
import { buildGeminiContents, generateGeminiResponseStreamFromContents, getAssistantText } from '../lib/geminiEngine';
import { buildMergeContext, buildMergeRequestContents, isMergeableAssistant } from '../lib/mergeContext';
import { getNodeSummary, mergeEvents } from '../lib/chatEvents';
import type { ChatEvent, MergeContextMode } from '../store/types';
import { reconstructMemory } from '../lib/memoryEngine';
import { buildImportedPathGroups, getImportedPathGroupPositionKey } from '../lib/import/pathGroups';

const nodeTypes = {
    custom: CustomNode,
};

export function GraphView() {
    const {
        nodes: storeNodes,
        previewNodes,
        groups: storeGroups,
        uiPositions,
        activeNodeId,
        apiKey,
        selectedNodeIds,
        setActiveNode,
        toggleNodeSelection,
        setSelectedNodeIds,
        clearNodeSelection,
        createGroup,
        addNode,
        setUiPosition,
        importEnvelope,
        previewImportEnvelope,
    } = useGraphStore();

    const [rfNodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [isGrouping, setIsGrouping] = useState(false);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const { setCenter } = useReactFlow();
    const renderedNodes = previewNodes ?? storeNodes;
    const renderedImportEnvelope = previewImportEnvelope ?? importEnvelope;

    const getPathGroupSavedPosition = useCallback((pathGroup: { id: string; nodeIds: string[]; primaryNodeId: string }) => {
        return (
            uiPositions[getImportedPathGroupPositionKey(pathGroup)] ??
            uiPositions[pathGroup.primaryNodeId] ??
            pathGroup.nodeIds.map((nodeId) => uiPositions[nodeId]).find(Boolean)
        );
    }, [uiPositions]);

    useEffect(() => {
        const rawNodes: Node[] = [];
        const rawEdges: Edge[] = [];
        const pathGroups = buildImportedPathGroups({ nodes: renderedNodes, importEnvelope: renderedImportEnvelope });
        const displayIdByImportedNodeId = new Map<string, string>();

        for (const pathGroup of pathGroups) {
            for (const nodeId of pathGroup.nodeIds) {
                displayIdByImportedNodeId.set(nodeId, pathGroup.id);
            }
        }

        pathGroups.forEach((pathGroup) => {
            rawNodes.push({
                id: pathGroup.id,
                type: 'custom',
                position: getPathGroupSavedPosition(pathGroup) ?? { x: 0, y: 0 },
                selected: selectedNodeIds.includes(pathGroup.primaryNodeId),
                data: {
                    pathGroup,
                    isActive: pathGroup.nodeIds.includes(activeNodeId ?? ''),
                    isSelected: selectedNodeIds.includes(pathGroup.primaryNodeId),
                    groups: [],
                    onInspectPathGroup: (selectedPathGroup: { primaryNodeId: string }) => {
                        clearNodeSelection();
                        setActiveNode(selectedPathGroup.primaryNodeId);
                    },
                },
            });

            pathGroup.parentGroupIds.forEach((parentGroupId) => {
                rawEdges.push({
                    id: `e-${parentGroupId}-${pathGroup.id}`,
                    source: parentGroupId,
                    target: pathGroup.id,
                    type: 'smoothstep',
                    animated: pathGroup.nodeIds.includes(activeNodeId ?? ''),
                    style: {
                        stroke: pathGroup.nodeIds.includes(activeNodeId ?? '') ? '#3b82f6' : pathGroup.inferred ? '#818cf8' : '#cbd5e1',
                        strokeWidth: pathGroup.nodeIds.includes(activeNodeId ?? '') ? 3 : pathGroup.inferred ? 2.5 : 2,
                        strokeDasharray: pathGroup.inferred ? '6 4' : undefined,
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: pathGroup.nodeIds.includes(activeNodeId ?? '') ? '#3b82f6' : pathGroup.inferred ? '#818cf8' : '#cbd5e1',
                    },
                });
            });
        });

        Object.values(renderedNodes).forEach((node) => {
            if (node.importMetadata?.origin === 'imported' && pathGroups.length > 0) {
                return;
            }

            rawNodes.push({
                id: node.id,
                type: 'custom',
                position: { x: 0, y: 0 },
                selected: selectedNodeIds.includes(node.id),
                data: {
                    node,
                    isActive: node.id === activeNodeId,
                    isSelected: selectedNodeIds.includes(node.id),
                    groups: (node.groupIds ?? []).map((groupId) => storeGroups[groupId]).filter(Boolean),
                },
            });

            const parentEdgeIds = node.parentIds && node.parentIds.length > 0
                ? node.parentIds
                : node.parentId
                    ? [node.parentId]
                    : [];

            const normalizedParentEdges = parentEdgeIds.map((parentId) => ({
                parentId,
                displayParentId: displayIdByImportedNodeId.get(parentId) ?? parentId,
            })).filter((edge, index, edges) =>
                edges.findIndex((candidate) => candidate.displayParentId === edge.displayParentId) === index,
            );

            normalizedParentEdges.forEach(({ parentId, displayParentId }) => {
                const isPrimaryEdge = parentId === node.parentId || parentEdgeIds.length === 1;
                const isInferredEdge = Boolean(node.inferenceMetadata?.inferred) && !isPrimaryEdge;
                rawEdges.push({
                    id: `e-${displayParentId}-${node.id}`,
                    source: displayParentId,
                    target: node.id,
                    type: 'smoothstep',
                    animated: node.id === activeNodeId && isPrimaryEdge,
                    style: {
                        stroke: node.id === activeNodeId && isPrimaryEdge
                            ? '#3b82f6'
                            : isInferredEdge
                                ? '#818cf8'
                                : '#cbd5e1',
                        strokeWidth: node.id === activeNodeId && isPrimaryEdge ? 3 : isInferredEdge ? 2.5 : 2,
                        strokeDasharray: isInferredEdge ? '6 4' : undefined,
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: node.id === activeNodeId && isPrimaryEdge
                            ? '#3b82f6'
                            : isInferredEdge
                                ? '#818cf8'
                                : '#cbd5e1',
                    },
                });
            });
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges, 'TB', uiPositions);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [renderedNodes, storeGroups, activeNodeId, selectedNodeIds, setNodes, setEdges, renderedImportEnvelope, uiPositions, getPathGroupSavedPosition, clearNodeSelection, setActiveNode]);

    useEffect(() => {
        if (activeNodeId && rfNodes.length > 0) {
            const activeNode = rfNodes.find((node) => {
                const data = node.data as { pathGroup?: { nodeIds: string[] } };
                return node.id === activeNodeId || data.pathGroup?.nodeIds.includes(activeNodeId);
            });
            if (activeNode) {
                const x = activeNode.position.x + 125;
                const y = activeNode.position.y + 50;
                setCenter(x, y, { zoom: 1, duration: 800 });
            }
        }
    }, [activeNodeId, rfNodes, setCenter]);

    useEffect(() => {
        const handleSelectionShortcuts = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            if (event.key === 'Escape') {
                clearNodeSelection();
                setIsSelectionMode(false);
                return;
            }

            if (event.key.toLowerCase() === 'v') {
                event.preventDefault();
                setIsSelectionMode((current) => !current);
            }
        };

        window.addEventListener('keydown', handleSelectionShortcuts);
        return () => window.removeEventListener('keydown', handleSelectionShortcuts);
    }, [clearNodeSelection]);

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        const nodeData = node.data as { pathGroup?: { primaryNodeId: string } };
        const targetNodeId = nodeData.pathGroup?.primaryNodeId ?? node.id;
        if (isSelectionMode) {
            toggleNodeSelection(targetNodeId);
            return;
        }

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            toggleNodeSelection(targetNodeId);
            return;
        }

        clearNodeSelection();
        setActiveNode(targetNodeId);
    }, [clearNodeSelection, isSelectionMode, setActiveNode, toggleNodeSelection]);

    const handleSelectionModeToggle = () => {
        setIsSelectionMode((current) => {
            if (current) {
                clearNodeSelection();
            }
            return !current;
        });
    };

    const handleClearSelection = () => {
        clearNodeSelection();
    };

    const handleNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
        const nodeData = node.data as { pathGroup?: { id: string; nodeIds: string[]; primaryNodeId: string } };
        const pathGroup = nodeData.pathGroup;

        if (pathGroup) {
            setUiPosition(getImportedPathGroupPositionKey(pathGroup), node.position);
            setUiPosition(pathGroup.primaryNodeId, node.position);
            pathGroup.nodeIds.forEach((nodeId) => setUiPosition(nodeId, node.position));
            return;
        }

        setUiPosition(node.id, node.position);
    }, [setUiPosition]);

    const selectedNodes = selectedNodeIds
        .map((id) => renderedNodes[id] ?? storeNodes[id])
        .filter(Boolean);
    const canMergeSelected = selectedNodes.length === 2 && selectedNodes.every(isMergeableAssistant) && !!apiKey;
    const canGroupSelected = selectedNodes.length > 0;

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
            clearNodeSelection();
            setIsMergeModalOpen(false);
        } finally {
            setIsMerging(false);
        }
    };

    const handleGroupSubmit = ({
        name,
        color,
        contextMode,
    }: {
        name: string;
        color: string;
        contextMode: 'full' | 'compact' | 'result_only' | 'exclude';
    }) => {
        setIsGrouping(true);
        try {
            createGroup({
                name,
                color,
                contextMode,
                nodeIds: selectedNodes.map((node) => node.id),
            });
            setIsGroupModalOpen(false);
        } finally {
            setIsGrouping(false);
        }
    };

    return (
        <div className="w-full h-full bg-slate-50 relative">
            <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
                <div className="font-semibold text-slate-700 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
                    Memory Tree Map
                </div>
                <button
                    onClick={handleSelectionModeToggle}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${
                        isSelectionMode
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                    }`}
                >
                    {isSelectionMode ? <SquareDashedMousePointer className="h-4 w-4" /> : <MousePointer2 className="h-4 w-4" />}
                    <span>{isSelectionMode ? 'Selecting Nodes' : 'Select Nodes'}</span>
                </button>
                <button
                    onClick={handleClearSelection}
                    disabled={selectedNodeIds.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <span>Clear Selection</span>
                </button>
                <button
                    onClick={() => setIsMergeModalOpen(true)}
                    disabled={!canMergeSelected}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-fuchsia-300 hover:bg-fuchsia-50 hover:text-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <GitMerge className="h-4 w-4" />
                    <span>Merge Selected</span>
                </button>
                <button
                    onClick={() => setIsGroupModalOpen(true)}
                    disabled={!canGroupSelected}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <FolderTree className="h-4 w-4" />
                    <span>Group Selected</span>
                </button>
            </div>
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={handleNodeDragStop}
                onNodeClick={onNodeClick}
                onPaneClick={clearNodeSelection}
                onSelectionChange={({ nodes: selectedFlowNodes }) => {
                    if (!isSelectionMode) {
                        return;
                    }

                    setSelectedNodeIds(selectedFlowNodes.map((selectedFlowNode) => {
                        const flowNodeData = selectedFlowNode.data as { pathGroup?: { primaryNodeId: string } };
                        return flowNodeData.pathGroup?.primaryNodeId ?? selectedFlowNode.id;
                    }));
                }}
                nodeTypes={nodeTypes}
                elementsSelectable={isSelectionMode}
                selectionKeyCode={null}
                selectionOnDrag={isSelectionMode}
                selectionMode={SelectionMode.Partial}
                multiSelectionKeyCode={null}
                panOnDrag={!isSelectionMode}
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
            <GroupNodesModal
                isOpen={isGroupModalOpen}
                selectedCount={selectedNodes.length}
                isSubmitting={isGrouping}
                onClose={() => setIsGroupModalOpen(false)}
                onSubmit={handleGroupSubmit}
            />
        </div>
    );
}
