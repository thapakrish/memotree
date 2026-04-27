import {
    Background,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    ReactFlowProvider,
    type Edge,
    type Node,
    useEdgesState,
    useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, ImageIcon, Maximize2, MessageSquare, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getImageArtifacts } from '../lib/chatEvents';
import { getImageSource } from '../lib/artifactStorage';
import { getLayoutedElements } from '../lib/layout';
import type { AttachmentPart, ImageFileArtifact, MessageNode } from '../store/types';
import { useGraphStore } from '../store/useGraphStore';

const CANVAS_NODE_WIDTH = 390;
const CANVAS_NODE_HEIGHT = 330;
const COMPACT_NODE_WIDTH = 190;
const COMPACT_NODE_HEIGHT = 78;
const COMPACT_IMAGE_NODE_HEIGHT = 126;

function formatBytes(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getRoleLabel(role: MessageNode['role']): string {
    if (role === 'assistant') return 'Gemini';
    if (role === 'user') return 'You';
    return 'System';
}

interface CanvasImageRef {
    artifact: ImageFileArtifact;
    use?: AttachmentPart['use'];
    origin: 'input' | 'output';
}

function getNodeImageRefs(
    node: MessageNode,
    artifacts: Record<string, ImageFileArtifact>,
): CanvasImageRef[] {
    const refs: CanvasImageRef[] = [];
    const seen = new Set<string>();

    for (const attachment of node.attachments ?? []) {
        if (attachment.kind !== 'image' || !attachment.artifactId) {
            continue;
        }
        const artifact = artifacts[attachment.artifactId];
        if (!artifact || seen.has(artifact.id)) {
            continue;
        }
        refs.push({ artifact, use: attachment.use, origin: 'input' });
        seen.add(artifact.id);
    }

    for (const imageArtifact of getImageArtifacts(node.events)) {
        const artifactId = imageArtifact.artifactId ?? imageArtifact.id;
        const artifact = artifacts[artifactId];
        if (!artifact || seen.has(artifact.id)) {
            continue;
        }
        refs.push({ artifact, origin: 'output' });
        seen.add(artifact.id);
    }

    return refs;
}

interface CanvasTurnNodeData {
    node: MessageNode;
    images: CanvasImageRef[];
    isProminent: boolean;
    isActive: boolean;
    isOnActivePath: boolean;
    selectedArtifactIds: string[];
    onActivate: (nodeId: string) => void;
    onPreview: (artifactId: string) => void;
    onToggleSelection: (artifactId: string) => void;
}

interface CanvasTurnNodeProps {
    data: CanvasTurnNodeData;
}

function CanvasTurnNode({ data }: CanvasTurnNodeProps) {
    const roleLabel = getRoleLabel(data.node.role);
    const imageCount = data.images.length;
    const nodeWidth = data.isProminent ? CANVAS_NODE_WIDTH : COMPACT_NODE_WIDTH;
    const nodeIcon = data.node.role === 'assistant'
        ? <Sparkles className="h-3.5 w-3.5 text-purple-500" />
        : <MessageSquare className="h-3.5 w-3.5 text-blue-500" />;

    if (!data.isProminent) {
        return (
            <div
                role="button"
                tabIndex={0}
                onClick={() => data.onActivate(data.node.id)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        data.onActivate(data.node.id);
                    }
                }}
                className={`group overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
                    data.isActive
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : data.isOnActivePath
                            ? 'border-blue-200 hover:border-blue-400'
                            : 'border-slate-200 hover:border-slate-400'
                }`}
                style={{ width: nodeWidth }}
                title="Show this turn in chat"
            >
                <Handle type="target" position={Position.Top} className="h-3 w-3 bg-slate-400" />
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                        {nodeIcon}
                        <span className="truncate text-xs font-bold uppercase tracking-wide text-slate-600">{roleLabel}</span>
                    </div>
                    {imageCount > 0 && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                            {imageCount}
                        </span>
                    )}
                </div>
                {imageCount > 0 && (
                    <div className="flex gap-1 px-3 pb-2">
                        {data.images.slice(0, 3).map(({ artifact, use, origin }) => {
                            const imageSource = getImageSource(artifact);
                            const isSelected = data.selectedArtifactIds.includes(artifact.id);
                            return (
                                <div
                                    key={artifact.id}
                                    className={`relative h-10 flex-1 overflow-hidden rounded border bg-slate-50 ${
                                        isSelected ? 'border-blue-500 ring-1 ring-blue-200' : 'border-slate-200'
                                    }`}
                                >
                                    {imageSource ? (
                                        <img
                                            src={imageSource}
                                            alt={artifact.label ?? artifact.name}
                                            className="h-full w-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-slate-300">
                                            <ImageIcon className="h-4 w-4" />
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            data.onPreview(artifact.id);
                                        }}
                                        className="nodrag nopan absolute inset-0"
                                        title={`Open ${use === 'edit_target' ? 'edit target' : origin} image`}
                                        aria-label="Open large preview"
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
                <Handle type="source" position={Position.Bottom} className="h-3 w-3 bg-slate-400" />
            </div>
        );
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => data.onActivate(data.node.id)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    data.onActivate(data.node.id);
                }
            }}
            className={`group overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
                data.isActive
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : data.isOnActivePath
                        ? 'border-blue-200 hover:border-blue-400'
                        : 'border-slate-200 hover:border-slate-400'
            }`}
            style={{ width: nodeWidth }}
            title="Show this turn in chat"
        >
            <Handle type="target" position={Position.Top} className="h-3 w-3 bg-slate-400" />
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <div className="flex items-center gap-2">
                    {nodeIcon}
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{roleLabel}</span>
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                    {imageCount} image{imageCount === 1 ? '' : 's'}
                </span>
            </div>

            {imageCount > 0 ? (
                <div className={imageCount === 1 ? 'p-3' : 'grid grid-cols-2 gap-2 p-3'}>
                    {data.images.slice(0, 4).map(({ artifact, use, origin }) => {
                        const imageSource = getImageSource(artifact);
                        const isSelected = data.selectedArtifactIds.includes(artifact.id);
                        return (
                            <div
                                key={artifact.id}
                                className={`relative overflow-hidden rounded-md border bg-slate-50 ${
                                    imageCount === 1 ? 'h-64' : 'h-36'
                                } ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'}`}
                            >
                                {imageSource ? (
                                    <img
                                        src={imageSource}
                                        alt={artifact.label ?? artifact.name}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                                        <ImageIcon className="h-8 w-8" />
                                    </div>
                                )}
                                <div className="absolute left-2 top-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">
                                    {use === 'edit_target' ? 'edit' : origin}
                                </div>
                                <div className="absolute right-2 top-2 flex gap-1">
                                    <button
                                        type="button"
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            data.onToggleSelection(artifact.id);
                                        }}
                                        className={`nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border shadow-sm transition-colors ${
                                            isSelected
                                                ? 'border-blue-500 bg-blue-600 text-white'
                                                : 'border-slate-200 bg-white/95 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                                        }`}
                                        title="Select image"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            data.onPreview(artifact.id);
                                        }}
                                        className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-600"
                                        title="Open large preview"
                                    >
                                        <Maximize2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="flex h-40 items-center justify-center bg-slate-50 text-slate-300">
                    <MessageSquare className="h-8 w-8" />
                </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
                <span>{new Date(data.node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {imageCount > 0 && (
                    <span>{formatBytes(data.images[0]?.artifact.sizeBytes)}</span>
                )}
            </div>
            <Handle type="source" position={Position.Bottom} className="h-3 w-3 bg-slate-400" />
        </div>
    );
}

const nodeTypes = {
    canvasTurn: CanvasTurnNode,
};

interface ArtifactFlowProps {
    onPreview: (artifactId: string) => void;
}

function ArtifactFlow({ onPreview }: ArtifactFlowProps) {
    const {
        nodes: storeNodes,
        artifacts,
        activeNodeId,
        getPath,
        uiPositions,
        setActiveNode,
        setUiPosition,
        canvasSelectedArtifactIds,
        toggleCanvasArtifactSelection,
        clearCanvasArtifactSelection,
    } = useGraphStore();
    const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

    const activePathIds = useMemo(
        () => new Set(getPath(activeNodeId).map((node) => node.id)),
        [activeNodeId, getPath],
    );
    const selectedCount = canvasSelectedArtifactIds.filter((id) => artifacts[id]).length;

    const { flowNodes, flowEdges, imageNodeCount } = useMemo(() => {
        const rawNodes: Node[] = Object.values(storeNodes)
            .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
            .map((node) => {
                const images = getNodeImageRefs(node, artifacts);
                const isProminent = node.role === 'assistant' && images.some((image) => image.origin === 'output');
                const layoutSize = isProminent
                    ? { width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT }
                    : {
                        width: COMPACT_NODE_WIDTH,
                        height: images.length > 0 ? COMPACT_IMAGE_NODE_HEIGHT : COMPACT_NODE_HEIGHT,
                    };

                return {
                    id: node.id,
                    type: 'canvasTurn',
                    position: { x: 0, y: 0 },
                    data: {
                        node,
                        images,
                        isProminent,
                        isActive: node.id === activeNodeId,
                        isOnActivePath: activePathIds.has(node.id),
                        selectedArtifactIds: canvasSelectedArtifactIds,
                        onActivate: setActiveNode,
                        onPreview,
                        onToggleSelection: toggleCanvasArtifactSelection,
                        layoutSize,
                    },
                };
            });

        const rawEdges: Edge[] = Object.values(storeNodes).flatMap((node) => {
            const parentIds = node.parentIds && node.parentIds.length > 0
                ? node.parentIds
                : node.parentId
                    ? [node.parentId]
                    : [];

            return parentIds.map((parentId) => {
                const isActivePathEdge = activePathIds.has(parentId) && activePathIds.has(node.id);
                return {
                    id: `edge-${parentId}-${node.id}`,
                    source: parentId,
                    target: node.id,
                    type: 'smoothstep',
                    animated: node.id === activeNodeId,
                    style: {
                        stroke: isActivePathEdge ? '#3b82f6' : '#cbd5e1',
                        strokeWidth: isActivePathEdge ? 3 : 2,
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: isActivePathEdge ? '#3b82f6' : '#cbd5e1',
                    },
                };
            });
        });

        const layouted = getLayoutedElements(rawNodes, rawEdges, 'TB', uiPositions, {
            width: CANVAS_NODE_WIDTH,
            height: CANVAS_NODE_HEIGHT,
        });

        return {
            flowNodes: layouted.nodes,
            flowEdges: layouted.edges,
            imageNodeCount: Object.keys(artifacts).length,
        };
    }, [
        activeNodeId,
        activePathIds,
        artifacts,
        canvasSelectedArtifactIds,
        onPreview,
        setActiveNode,
        storeNodes,
        toggleCanvasArtifactSelection,
        uiPositions,
    ]);

    useEffect(() => {
        setRfNodes(flowNodes);
        setRfEdges(flowEdges);
    }, [flowEdges, flowNodes, setRfEdges, setRfNodes]);

    const handleNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
        setUiPosition(node.id, node.position);
    }, [setUiPosition]);

    return (
        <div className="flex h-full flex-col bg-slate-50 text-slate-900">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-blue-600" />
                        <h2 className="truncate text-sm font-semibold">Memo Canvas</h2>
                    </div>
                    <p className="truncate text-xs text-slate-400">
                        {imageNodeCount} image artifact{imageNodeCount === 1 ? '' : 's'} in this graph
                    </p>
                </div>
                {selectedCount > 0 && (
                    <button
                        onClick={clearCanvasArtifactSelection}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                        title="Clear canvas selection"
                    >
                        <X className="h-3.5 w-3.5" />
                        {selectedCount} selected
                    </button>
                )}
            </div>

            {rfNodes.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                    <div className="max-w-sm text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300">
                            <MessageSquare className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-sm font-semibold text-slate-700">No active branch</h3>
                    </div>
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    <ReactFlow
                        nodes={rfNodes}
                        edges={rfEdges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeClick={(_, node) => setActiveNode(node.id)}
                        onNodeDragStop={handleNodeDragStop}
                        fitView
                        fitViewOptions={{ padding: 0.14, maxZoom: 0.95 }}
                        minZoom={0.25}
                        maxZoom={1.15}
                        nodesDraggable
                        nodesConnectable={false}
                        elementsSelectable={false}
                    >
                        <Background color="#e2e8f0" gap={24} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                </div>
            )}
        </div>
    );
}

function ImagePreviewOverlay({
    artifact,
    imageSource,
    onClose,
}: {
    artifact: ImageFileArtifact;
    imageSource: string;
    onClose: () => void;
}) {
    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
            onClick={onClose}
        >
            <div
                className="flex h-[94dvh] w-[96vw] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">
                            {artifact.label ?? artifact.name}
                        </div>
                        <div className="truncate text-xs text-slate-400">{artifact.path}</div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        title="Close preview"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-4">
                    {imageSource ? (
                        <img
                            src={imageSource}
                            alt={artifact.label ?? artifact.name}
                            className="max-h-full max-w-full object-contain"
                        />
                    ) : (
                        <ImageIcon className="h-12 w-12 text-slate-300" />
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

export function ImageCanvas() {
    const { artifacts } = useGraphStore();
    const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
    const previewArtifact = previewArtifactId ? artifacts[previewArtifactId] : undefined;
    const previewSource = previewArtifact ? getImageSource(previewArtifact) : '';
    const handlePreview = useCallback((artifactId: string) => {
        setPreviewArtifactId(artifactId);
    }, []);

    return (
        <ReactFlowProvider>
            <ArtifactFlow onPreview={handlePreview} />
            {previewArtifact && (
                <ImagePreviewOverlay
                    artifact={previewArtifact}
                    imageSource={previewSource}
                    onClose={() => setPreviewArtifactId(null)}
                />
            )}
        </ReactFlowProvider>
    );
}
