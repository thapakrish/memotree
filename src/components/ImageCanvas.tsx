import {
    Background,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    ReactFlowProvider,
    SelectionMode,
    type Edge,
    type Node,
    useReactFlow,
    useEdgesState,
    useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Check,
    FolderTree,
    GitBranch,
    ImageIcon,
    Maximize2,
    MessageSquare,
    MousePointer2,
    Network,
    Pencil,
    RotateCcw,
    Scissors,
    Sparkles,
    SquareDashedMousePointer,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getImageArtifacts } from '../lib/chatEvents';
import { getImageSource } from '../lib/artifactStorage';
import { getLayoutedElements } from '../lib/layout';
import { getImageModelDisplayName } from '../lib/geminiModels';
import { GroupNodesModal } from './GroupNodesModal';
import { featureFlags } from '../config/featureFlags';
import type { AttachmentPart, ContextGroup, ImageFileArtifact, MessageNode, SessionIntent } from '../store/types';
import { useGraphStore } from '../store/useGraphStore';

const CANVAS_NODE_WIDTH = 390;
const CANVAS_NODE_HEIGHT = 330;
const COMPACT_NODE_WIDTH = 190;
const COMPACT_NODE_HEIGHT = 78;
const COMPACT_IMAGE_NODE_HEIGHT = 126;
const IMAGE_WORKSPACE_INTENTS = new Set<SessionIntent>(['image_generate', 'image_edit', 'style_fit', 'variants']);
const CANVAS_STARTER_INTENTS: Array<{
    intent: SessionIntent;
    label: string;
    tone: string;
}> = [
    { intent: 'ask', label: 'Ask', tone: 'border-blue-300 bg-blue-50 text-blue-700' },
    { intent: 'image_generate', label: 'Generate Image', tone: 'border-cyan-300 bg-cyan-50 text-cyan-800' },
    { intent: 'image_edit', label: 'Edit Image', tone: 'border-amber-300 bg-amber-50 text-amber-800' },
    { intent: 'style_fit', label: 'Fit Style', tone: 'border-violet-300 bg-violet-50 text-violet-800' },
    { intent: 'variants', label: 'Explore Variants', tone: 'border-rose-300 bg-rose-50 text-rose-800' },
];

type ImageCanvasView = 'workspace' | 'timeline';

interface ImagePreviewNavigation {
    nodeLabel: string;
    nodeSummary: string;
    imagePositionLabel: string;
    nodePositionLabel: string;
    sameNodeImages: ImageFileArtifact[];
    previousImageId?: string;
    nextImageId?: string;
    previousNodeImageId?: string;
    nextNodeImageId?: string;
}

function formatBytes(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageWorkspaceIntent(intent?: SessionIntent): boolean {
    return Boolean(intent && IMAGE_WORKSPACE_INTENTS.has(intent));
}

function getWorkspaceSubtitle(intent?: SessionIntent): string {
    switch (intent) {
        case 'image_generate':
            return 'Prompt-generated outputs and reusable image options';
        case 'image_edit':
            return 'Source image, edits, and image references';
        case 'style_fit':
            return 'Source image, style direction, and fitted outputs';
        case 'variants':
            return 'Source image and branchable visual alternatives';
        default:
            return 'Images in this session';
    }
}

function getStarterIcon(intent: SessionIntent) {
    switch (intent) {
        case 'ask':
            return <MessageSquare className="h-4 w-4" />;
        case 'image_generate':
            return <ImageIcon className="h-4 w-4" />;
        case 'image_edit':
            return <Pencil className="h-4 w-4" />;
        case 'style_fit':
            return <Sparkles className="h-4 w-4" />;
        case 'variants':
            return <RotateCcw className="h-4 w-4" />;
    }
}

function openComposerForCanvasStart() {
    window.dispatchEvent(new Event('memotree:open-chat'));
    window.dispatchEvent(new Event('memotree:focus-composer'));
}

function getCanvasNodeLabel(node: MessageNode, images: CanvasImageRef[]): string {
    if (node.role === 'user') return 'You';
    if (node.role === 'system') return 'System';

    const labels = [...new Set(
        images
            .filter((image) => image.origin === 'output')
            .map((image) => getImageModelDisplayName(image.artifact.model))
            .filter((label): label is string => Boolean(label)),
    )];

    if (labels.length === 0) {
        return 'Gemini';
    }

    return labels.length === 1 ? labels[0] : 'Mixed models';
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

function getNodeSummaryText(node: MessageNode): string {
    const text = node.summary ?? node.content;
    if (!text) {
        return node.role === 'assistant' ? 'Assistant response' : 'User prompt';
    }

    return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function buildImagePreviewNavigation(
    nodes: Record<string, MessageNode>,
    artifacts: Record<string, ImageFileArtifact>,
    artifactId: string,
): ImagePreviewNavigation | undefined {
    const imageNodes = Object.values(nodes)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .map((node) => ({
            node,
            images: getNodeImageRefs(node, artifacts),
        }))
        .filter(({ images }) => images.length > 0);

    const nodeIndex = imageNodes.findIndex(({ images }) =>
        images.some(({ artifact }) => artifact.id === artifactId),
    );

    if (nodeIndex < 0) {
        return undefined;
    }

    const current = imageNodes[nodeIndex];
    const imageIndex = current.images.findIndex(({ artifact }) => artifact.id === artifactId);
    const sameNodeArtifacts = current.images.map(({ artifact }) => artifact);
    const pickNodeImage = (targetNodeIndex: number) => {
        const targetNode = imageNodes[targetNodeIndex];
        if (!targetNode) {
            return undefined;
        }

        return targetNode.images[Math.min(imageIndex, targetNode.images.length - 1)]?.artifact.id;
    };

    return {
        nodeLabel: getCanvasNodeLabel(current.node, current.images),
        nodeSummary: getNodeSummaryText(current.node),
        imagePositionLabel: `${imageIndex + 1} of ${current.images.length}`,
        nodePositionLabel: `${nodeIndex + 1} of ${imageNodes.length}`,
        sameNodeImages: sameNodeArtifacts,
        previousImageId: current.images[imageIndex - 1]?.artifact.id,
        nextImageId: current.images[imageIndex + 1]?.artifact.id,
        previousNodeImageId: pickNodeImage(nodeIndex - 1),
        nextNodeImageId: pickNodeImage(nodeIndex + 1),
    };
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

interface CanvasTurnNodeData {
    node: MessageNode;
    images: CanvasImageRef[];
    isProminent: boolean;
    isActive: boolean;
    isSelected: boolean;
    isOnActivePath: boolean;
    groups: ContextGroup[];
    selectedArtifactIds: string[];
    layoutSize: { width: number; height: number };
    onActivate: (nodeId: string) => void;
    onPreview: (artifactId: string) => void;
    onToggleSelection: (artifactId: string) => void;
}

interface CanvasTurnNodeProps {
    data: CanvasTurnNodeData;
}

function CanvasTurnNode({ data }: CanvasTurnNodeProps) {
    const roleLabel = getCanvasNodeLabel(data.node, data.images);
    const imageCount = data.images.length;
    const nodeWidth = data.isProminent ? CANVAS_NODE_WIDTH : COMPACT_NODE_WIDTH;
    const primaryGroup = data.groups[0];
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
                className={`group relative overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
                    data.isSelected
                        ? 'border-amber-500 ring-2 ring-amber-200'
                        : data.isActive
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : data.isOnActivePath
                            ? 'border-blue-200 hover:border-blue-400'
                            : 'border-slate-200 hover:border-slate-400'
                }`}
                style={{ width: nodeWidth }}
                title="Show this turn in chat"
            >
                {primaryGroup && (
                    <div
                        className="absolute inset-x-0 top-0 h-1"
                        style={{ backgroundColor: primaryGroup.color }}
                    />
                )}
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
            className={`group relative overflow-hidden rounded-lg border bg-white shadow-sm transition-colors ${
                data.isSelected
                    ? 'border-amber-500 ring-2 ring-amber-200'
                    : data.isActive
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : data.isOnActivePath
                        ? 'border-blue-200 hover:border-blue-400'
                        : 'border-slate-200 hover:border-slate-400'
            }`}
            style={{ width: nodeWidth }}
            title="Show this turn in chat"
        >
            {primaryGroup && (
                <div
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ backgroundColor: primaryGroup.color }}
                />
            )}
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
                {data.groups.length > 0 && (
                    <div className="flex min-w-0 flex-1 justify-center gap-1 px-2">
                        {data.groups.slice(0, 2).map((group) => (
                            <span
                                key={group.id}
                                className="truncate rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ backgroundColor: `${group.color}18`, color: group.color }}
                            >
                                {group.name}
                            </span>
                        ))}
                    </div>
                )}
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
    headerActions?: ReactNode;
}

function ArtifactFlow({ onPreview, headerActions }: ArtifactFlowProps) {
    const {
        nodes: storeNodes,
        artifacts,
        groups: storeGroups,
        activeNodeId,
        getPath,
        uiPositions,
        canvasPrunedNodeIds,
        selectedNodeIds,
        setActiveNode,
        setUiPosition,
        setSelectedNodeIds,
        toggleNodeSelection,
        clearNodeSelection,
        createGroup,
        pruneCanvasNodes,
        restoreCanvasPruning,
        canvasSelectedArtifactIds,
        toggleCanvasArtifactSelection,
        clearCanvasArtifactSelection,
    } = useGraphStore();
    const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isGrouping, setIsGrouping] = useState(false);
    const { fitBounds, setCenter } = useReactFlow();

    const activePathIds = useMemo(
        () => new Set(getPath(activeNodeId).map((node) => node.id)),
        [activeNodeId, getPath],
    );
    const prunedNodeIds = useMemo(
        () => collectNodeSubtreeIds(storeNodes, canvasPrunedNodeIds),
        [canvasPrunedNodeIds, storeNodes],
    );
    const selectedArtifactCount = canvasSelectedArtifactIds.filter((id) => artifacts[id]).length;
    const selectedNodes = selectedNodeIds.flatMap((id) => {
        const node = storeNodes[id];
        return node ? [node] : [];
    });
    const visibleSelectedNodeIds = selectedNodeIds.filter((id) => storeNodes[id] && !prunedNodeIds.has(id));
    const canUseOrganizationTools = featureFlags.canvasOrganizationTools;

    const handleNodeActivate = useCallback((nodeId: string) => {
        if (isSelectionMode) {
            toggleNodeSelection(nodeId);
            return;
        }

        clearNodeSelection();
        setActiveNode(nodeId);
    }, [clearNodeSelection, isSelectionMode, setActiveNode, toggleNodeSelection]);

    const { flowNodes, flowEdges, imageNodeCount } = useMemo(() => {
        const rawNodes: Node[] = Object.values(storeNodes)
            .filter((node) => !prunedNodeIds.has(node.id))
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
                    selected: selectedNodeIds.includes(node.id),
                    data: {
                        node,
                        images,
                        isProminent,
                        isActive: node.id === activeNodeId,
                        isSelected: selectedNodeIds.includes(node.id),
                        isOnActivePath: activePathIds.has(node.id),
                        groups: (node.groupIds ?? []).map((groupId) => storeGroups[groupId]).filter(Boolean),
                        selectedArtifactIds: canvasSelectedArtifactIds,
                        onActivate: handleNodeActivate,
                        onPreview,
                        onToggleSelection: toggleCanvasArtifactSelection,
                        layoutSize,
                    },
                };
            });

        const rawEdges: Edge[] = Object.values(storeNodes).flatMap((node) => {
            if (prunedNodeIds.has(node.id)) {
                return [];
            }

            const parentIds = node.parentIds && node.parentIds.length > 0
                ? node.parentIds
                : node.parentId
                    ? [node.parentId]
                    : [];

            return parentIds.filter((parentId) => !prunedNodeIds.has(parentId)).map((parentId) => {
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
        handleNodeActivate,
        onPreview,
        prunedNodeIds,
        selectedNodeIds,
        storeGroups,
        storeNodes,
        toggleCanvasArtifactSelection,
        uiPositions,
    ]);

    useEffect(() => {
        setRfNodes(flowNodes);
        setRfEdges(flowEdges);
    }, [flowEdges, flowNodes, setRfEdges, setRfNodes]);

    const centerActiveNode = useCallback(() => {
        if (!activeNodeId || rfNodes.length === 0) {
            return;
        }

        const activeNode = rfNodes.find((node) => node.id === activeNodeId);
        if (!activeNode) {
            return;
        }

        const data = activeNode.data as { layoutSize?: { width: number; height: number } };
        const width = data.layoutSize?.width ?? CANVAS_NODE_WIDTH;
        const height = data.layoutSize?.height ?? CANVAS_NODE_HEIGHT;
        const isMobile = window.matchMedia('(max-width: 767px)').matches;
        if (isMobile) {
            requestAnimationFrame(() => {
                void fitBounds(
                    {
                        x: activeNode.position.x,
                        y: activeNode.position.y,
                        width,
                        height,
                    },
                    { padding: 0.18, duration: 420 },
                );
            });
            return;
        }

        requestAnimationFrame(() => {
            void setCenter(
                activeNode.position.x + width / 2,
                activeNode.position.y + height / 2,
                { zoom: 0.85, duration: 420 },
            );
        });
    }, [activeNodeId, fitBounds, rfNodes, setCenter]);

    useEffect(() => {
        centerActiveNode();
    }, [centerActiveNode]);

    useEffect(() => {
        const handleCanvasVisible = () => {
            window.setTimeout(centerActiveNode, 80);
        };
        window.addEventListener('memotree:canvas-visible', handleCanvasVisible);
        window.addEventListener('resize', handleCanvasVisible);
        return () => {
            window.removeEventListener('memotree:canvas-visible', handleCanvasVisible);
            window.removeEventListener('resize', handleCanvasVisible);
        };
    }, [centerActiveNode]);

    const handleNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
        setUiPosition(node.id, node.position);
    }, [setUiPosition]);

    const handleSelectionModeToggle = useCallback(() => {
        setIsSelectionMode((current) => {
            if (current) {
                clearNodeSelection();
            }
            return !current;
        });
    }, [clearNodeSelection]);

    const handleSelectActivePath = useCallback(() => {
        const ids = [...activePathIds].filter((id) => storeNodes[id] && !prunedNodeIds.has(id));
        setSelectedNodeIds(ids);
        setIsSelectionMode(true);
    }, [activePathIds, prunedNodeIds, setSelectedNodeIds, storeNodes]);

    const handleSelectActiveSubtree = useCallback(() => {
        if (!activeNodeId) {
            return;
        }

        const ids = [...collectNodeSubtreeIds(storeNodes, [activeNodeId])]
            .filter((id) => storeNodes[id] && !prunedNodeIds.has(id));
        setSelectedNodeIds(ids);
        setIsSelectionMode(true);
    }, [activeNodeId, prunedNodeIds, setSelectedNodeIds, storeNodes]);

    const handlePruneSelected = useCallback(() => {
        if (visibleSelectedNodeIds.length === 0) {
            return;
        }

        pruneCanvasNodes(visibleSelectedNodeIds);
    }, [pruneCanvasNodes, visibleSelectedNodeIds]);

    const handleGroupSubmit = useCallback(({
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
    }, [createGroup, selectedNodes]);

    return (
        <div className="flex h-full flex-col bg-slate-50 text-slate-900">
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-blue-600" />
                        <h2 className="truncate text-sm font-semibold">Memo Canvas</h2>
                    </div>
                    <p className="truncate text-xs text-slate-400">
                        {imageNodeCount} image artifact{imageNodeCount === 1 ? '' : 's'} in this graph
                    </p>
                </div>
                <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
                    {headerActions}
                    {canUseOrganizationTools && (
                        <>
                            <button
                                type="button"
                                onClick={handleSelectionModeToggle}
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                    isSelectionMode
                                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                                }`}
                                title="Select canvas nodes"
                                aria-label="Select canvas nodes"
                            >
                                {isSelectionMode ? <SquareDashedMousePointer className="h-3.5 w-3.5" /> : <MousePointer2 className="h-3.5 w-3.5" />}
                                <span className="hidden sm:inline">{isSelectionMode ? `${visibleSelectedNodeIds.length} selected` : 'Select'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleSelectActivePath}
                                disabled={!activeNodeId}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Select the active path"
                                aria-label="Select active path"
                            >
                                <GitBranch className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Path</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleSelectActiveSubtree}
                                disabled={!activeNodeId}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Select the active subtree"
                                aria-label="Select active subtree"
                            >
                                <Network className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Subtree</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsGroupModalOpen(true)}
                                disabled={visibleSelectedNodeIds.length === 0}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Group selected nodes"
                                aria-label="Group selected nodes"
                            >
                                <FolderTree className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Group</span>
                            </button>
                            <button
                                type="button"
                                onClick={handlePruneSelected}
                                disabled={visibleSelectedNodeIds.length === 0}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Hide selected nodes and their descendants from this canvas"
                                aria-label="Prune selected nodes"
                            >
                                <Scissors className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Prune</span>
                            </button>
                            {canvasPrunedNodeIds.length > 0 && (
                                <button
                                    type="button"
                                    onClick={restoreCanvasPruning}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                                    title="Restore pruned canvas nodes"
                                    aria-label="Restore pruned canvas nodes"
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Restore</span>
                                </button>
                            )}
                        </>
                    )}
                    {selectedArtifactCount > 0 && (
                        <button
                            type="button"
                            onClick={clearCanvasArtifactSelection}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                            title="Clear image selection"
                        >
                            <X className="h-3.5 w-3.5" />
                            {selectedArtifactCount} image{selectedArtifactCount === 1 ? '' : 's'}
                        </button>
                    )}
                </div>
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
                        onNodeDragStop={handleNodeDragStop}
                        onPaneClick={clearNodeSelection}
                        onSelectionChange={({ nodes: selectedFlowNodes }) => {
                            if (!isSelectionMode) {
                                return;
                            }

                            setSelectedNodeIds(selectedFlowNodes.map((selectedFlowNode) => selectedFlowNode.id));
                        }}
                        fitView
                        fitViewOptions={{ padding: 0.14, maxZoom: 0.95 }}
                        minZoom={0.25}
                        maxZoom={1.15}
                        nodesDraggable={!isSelectionMode}
                        nodesConnectable={false}
                        elementsSelectable={canUseOrganizationTools && isSelectionMode}
                        selectionKeyCode={null}
                        selectionOnDrag={canUseOrganizationTools && isSelectionMode}
                        selectionMode={SelectionMode.Partial}
                        multiSelectionKeyCode={null}
                        panOnDrag={!canUseOrganizationTools || !isSelectionMode}
                    >
                        <Background color="#e2e8f0" gap={24} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                </div>
            )}
            {canUseOrganizationTools && (
                <GroupNodesModal
                    isOpen={isGroupModalOpen}
                    selectedCount={selectedNodes.length}
                    isSubmitting={isGrouping}
                    onClose={() => setIsGroupModalOpen(false)}
                    onSubmit={handleGroupSubmit}
                />
            )}
        </div>
    );
}

function CanvasStarterBoard() {
    const { sessionIntent, setSessionIntent } = useGraphStore();

    const handleStart = useCallback((intent: SessionIntent) => {
        setSessionIntent(intent);
        openComposerForCanvasStart();
    }, [setSessionIntent]);

    return (
        <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900">
            <div className="absolute inset-0 bg-[linear-gradient(#e2e8f0_1px,transparent_1px),linear-gradient(90deg,#e2e8f0_1px,transparent_1px)] bg-[size:28px_28px]" />
            <div className="absolute inset-0 bg-white/65" />
            <div className="relative flex h-full min-h-0 flex-col">
                <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/92 px-4 py-2 backdrop-blur">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <GitBranch className="h-4 w-4 text-blue-600" />
                            <h2 className="truncate text-sm font-semibold">New Board</h2>
                        </div>
                        <p className="truncate text-xs text-slate-400">MemoTree</p>
                    </div>
                </div>

                <div className="relative min-h-0 flex-1 p-4 sm:p-8">
                    <div className="mx-auto grid h-full max-w-5xl items-center gap-5 lg:grid-cols-[minmax(260px,0.78fr)_minmax(420px,1.22fr)]">
                        <div className="order-2 grid gap-2 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
                            {CANVAS_STARTER_INTENTS.map((item) => {
                                const isActive = sessionIntent === item.intent;
                                return (
                                    <button
                                        key={item.intent}
                                        type="button"
                                        onClick={() => handleStart(item.intent)}
                                        className={`group flex min-h-14 items-center justify-between gap-3 rounded-lg border bg-white px-3 py-3 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                            isActive ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
                                        }`}
                                    >
                                        <span className="flex min-w-0 items-center gap-3">
                                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${item.tone}`}>
                                                {getStarterIcon(item.intent)}
                                            </span>
                                            <span className="truncate text-sm font-semibold text-slate-800">{item.label}</span>
                                        </span>
                                        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-200 transition-colors group-hover:bg-blue-500" />
                                    </button>
                                );
                            })}
                        </div>

                        <div className="order-1 lg:order-2">
                            <div className="relative mx-auto aspect-[4/3] w-full max-w-2xl">
                                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 640 480" aria-hidden="true">
                                    <path d="M320 96 C320 164 222 172 222 238" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
                                    <path d="M320 96 C320 164 418 172 418 238" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
                                    <path d="M222 296 C222 360 304 360 304 414" fill="none" stroke="#a78bfa" strokeWidth="3" strokeDasharray="7 7" strokeLinecap="round" />
                                    <path d="M418 296 C418 360 336 360 336 414" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="7 7" strokeLinecap="round" />
                                </svg>

                                <div className="absolute left-1/2 top-10 w-44 -translate-x-1/2 rounded-lg border border-blue-200 bg-white p-3 shadow-sm">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                                        <MessageSquare className="h-3.5 w-3.5" />
                                        Root
                                    </div>
                                    <div className="mt-2 h-2 rounded bg-slate-100" />
                                    <div className="mt-1 h-2 w-2/3 rounded bg-slate-100" />
                                </div>

                                <div className="absolute left-[10%] top-[43%] w-52 rounded-lg border border-cyan-200 bg-white p-3 shadow-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-800">
                                            <ImageIcon className="h-3.5 w-3.5" />
                                            Image
                                        </div>
                                        <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">3</span>
                                    </div>
                                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                                        <div className="aspect-square rounded bg-gradient-to-br from-cyan-400 to-blue-600" />
                                        <div className="aspect-square rounded bg-gradient-to-br from-violet-500 to-fuchsia-500" />
                                        <div className="aspect-square rounded bg-gradient-to-br from-amber-400 to-rose-500" />
                                    </div>
                                </div>

                                <div className="absolute right-[8%] top-[43%] w-52 rounded-lg border border-violet-200 bg-white p-3 shadow-sm">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-violet-800">
                                        <Sparkles className="h-3.5 w-3.5" />
                                        Style
                                    </div>
                                    <div className="mt-3 flex gap-1.5">
                                        <div className="h-14 flex-1 rounded bg-slate-800" />
                                        <div className="h-14 flex-1 rounded bg-slate-500" />
                                        <div className="h-14 flex-1 rounded bg-slate-300" />
                                    </div>
                                </div>

                                <div className="absolute bottom-3 left-1/2 w-56 -translate-x-1/2 rounded-lg border border-amber-200 bg-white p-3 shadow-sm">
                                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-800">
                                        <span className="flex items-center gap-2">
                                            <GitBranch className="h-3.5 w-3.5" />
                                            Variants
                                        </span>
                                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px]">A/B</span>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <div className="h-12 rounded border border-slate-200 bg-white" />
                                        <div className="h-12 rounded border border-slate-200 bg-white" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ImageCanvasViewSwitch({
    value,
    onChange,
}: {
    value: ImageCanvasView;
    onChange: (value: ImageCanvasView) => void;
}) {
    const buttonClassName = (mode: ImageCanvasView) => `inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        value === mode
            ? 'bg-white text-blue-700 shadow-sm'
            : 'text-slate-500 hover:text-slate-800'
    }`;

    return (
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label="Canvas view">
            <button
                type="button"
                onClick={() => onChange('workspace')}
                className={buttonClassName('workspace')}
                aria-pressed={value === 'workspace'}
                aria-label="Images"
                title="Show image workspace"
            >
                <ImageIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Images</span>
            </button>
            <button
                type="button"
                onClick={() => onChange('timeline')}
                className={buttonClassName('timeline')}
                aria-pressed={value === 'timeline'}
                aria-label="Timeline"
                title="Show node timeline"
            >
                <GitBranch className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Timeline</span>
            </button>
        </div>
    );
}

function ImagePreviewOverlay({
    artifact,
    imageSource,
    navigation,
    onNavigate,
    onClose,
}: {
    artifact: ImageFileArtifact;
    imageSource: string;
    navigation?: ImagePreviewNavigation;
    onNavigate: (artifactId: string) => void;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const navigateTo = useCallback((artifactId?: string) => {
        if (artifactId) {
            onNavigate(artifactId);
        }
    }, [onNavigate]);

    useEffect(() => {
        dialogRef.current?.focus();
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }

            if (!navigation) {
                return;
            }

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                event.stopPropagation();
                navigateTo(navigation.previousImageId);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                event.stopPropagation();
                navigateTo(navigation.nextImageId);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                navigateTo(navigation.previousNodeImageId);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                navigateTo(navigation.nextNodeImageId);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigateTo, navigation, onClose]);

    const navButtonClassName = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40';

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
            onClick={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="flex h-[94dvh] w-[96vw] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-800">
                            {artifact.label ?? artifact.name}
                        </div>
                        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-slate-400">
                            {navigation ? (
                                <>
                                    <span className="truncate font-medium text-slate-500">{navigation.nodeLabel}</span>
                                    <span>{navigation.imagePositionLabel}</span>
                                    <span>Node {navigation.nodePositionLabel}</span>
                                    <span className="truncate">{navigation.nodeSummary}</span>
                                </>
                            ) : (
                                <span className="truncate">{artifact.path}</span>
                            )}
                        </div>
                    </div>
                    {navigation && (
                        <div className="flex shrink-0 items-center gap-2">
                            <div className="inline-flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50 p-1">
                                <button
                                    type="button"
                                    onClick={() => navigateTo(navigation.previousNodeImageId)}
                                    disabled={!navigation.previousNodeImageId}
                                    className={navButtonClassName}
                                    title="Previous image node"
                                >
                                    <ArrowUp className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigateTo(navigation.nextNodeImageId)}
                                    disabled={!navigation.nextNodeImageId}
                                    className={navButtonClassName}
                                    title="Next image node"
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="inline-flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50 p-1">
                                <button
                                    type="button"
                                    onClick={() => navigateTo(navigation.previousImageId)}
                                    disabled={!navigation.previousImageId}
                                    className={navButtonClassName}
                                    title="Previous image in this node"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigateTo(navigation.nextImageId)}
                                    disabled={!navigation.nextImageId}
                                    className={navButtonClassName}
                                    title="Next image in this node"
                                >
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        title="Close preview"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-4">
                    {navigation?.previousImageId && (
                        <button
                            type="button"
                            onClick={() => navigateTo(navigation.previousImageId)}
                            className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-white/90 text-slate-600 shadow-lg transition-colors hover:text-blue-700"
                            title="Previous image in this node"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </button>
                    )}
                    {navigation?.nextImageId && (
                        <button
                            type="button"
                            onClick={() => navigateTo(navigation.nextImageId)}
                            className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-white/90 text-slate-600 shadow-lg transition-colors hover:text-blue-700"
                            title="Next image in this node"
                        >
                            <ArrowRight className="h-5 w-5" />
                        </button>
                    )}
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
                {navigation && navigation.sameNodeImages.length > 1 && (
                    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-slate-200 bg-white px-4 py-3">
                        {navigation.sameNodeImages.map((image, index) => {
                            const thumbnailSource = getImageSource(image);
                            const isActive = image.id === artifact.id;
                            return (
                                <button
                                    key={image.id}
                                    type="button"
                                    onClick={() => onNavigate(image.id)}
                                    className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-md border bg-slate-100 transition-colors ${
                                        isActive ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'
                                    }`}
                                    title={image.label ?? image.name}
                                >
                                    {thumbnailSource ? (
                                        <img
                                            src={thumbnailSource}
                                            alt={image.label ?? image.name}
                                            className="h-full w-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-slate-300">
                                            <ImageIcon className="h-5 w-5" />
                                        </div>
                                    )}
                                    <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-600">
                                        {index + 1}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

interface WorkspaceImageCardProps {
    artifact: ImageFileArtifact;
    isSource: boolean;
    onPreview: (artifactId: string) => void;
    onUseAsSource: (artifactId: string) => void;
    onFitStyle: (artifactId: string) => void;
    onMakeVariants: (artifactId: string) => void;
    onUseAsReference: (artifactId: string) => void;
}

function WorkspaceImageCard({
    artifact,
    isSource,
    onPreview,
    onUseAsSource,
    onFitStyle,
    onMakeVariants,
    onUseAsReference,
}: WorkspaceImageCardProps) {
    const imageSource = getImageSource(artifact);
    const modelLabel = getImageModelDisplayName(artifact.model);

    return (
        <div className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
            isSource ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'
        }`}>
            <button
                type="button"
                onClick={() => onPreview(artifact.id)}
                className="block aspect-[4/3] w-full bg-slate-100"
                title="Open large preview"
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
                        <ImageIcon className="h-8 w-8" />
                    </div>
                )}
            </button>
            <div className="space-y-3 p-3">
                <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold text-slate-800">
                            {artifact.label ?? artifact.name}
                        </div>
                        {isSource && (
                            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
                                Source
                            </span>
                        )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-400">
                        <span>{artifact.origin}</span>
                        {modelLabel && <span>{modelLabel}</span>}
                        {artifact.workflow?.styleLabel && <span>{artifact.workflow.styleLabel}</span>}
                        {(artifact.parentArtifactIds?.length ?? 0) > 0 && (
                            <span>{artifact.parentArtifactIds!.length} source{artifact.parentArtifactIds!.length === 1 ? '' : 's'}</span>
                        )}
                        {artifact.sizeBytes && <span>{formatBytes(artifact.sizeBytes)}</span>}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                    <button
                        type="button"
                        onClick={() => onUseAsSource(artifact.id)}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                        <Pencil className="h-3 w-3" />
                        Source
                    </button>
                    <button
                        type="button"
                        onClick={() => onFitStyle(artifact.id)}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                        <Sparkles className="h-3 w-3" />
                        Fit Style
                    </button>
                    <button
                        type="button"
                        onClick={() => onMakeVariants(artifact.id)}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                        <RotateCcw className="h-3 w-3" />
                        Variants
                    </button>
                    <button
                        type="button"
                        onClick={() => onUseAsReference(artifact.id)}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                        <ImageIcon className="h-3 w-3" />
                        Reference
                    </button>
                </div>
            </div>
        </div>
    );
}

function ImageWorkspace({
    onPreview,
    onChangeView,
}: {
    onPreview: (artifactId: string) => void;
    onChangeView: (value: ImageCanvasView) => void;
}) {
    const {
        artifacts,
        canvasSelectedArtifactIds,
        canvasSelectedArtifactUse,
        setCanvasArtifactSelection,
        setSessionIntent,
        sessionIntent,
    } = useGraphStore();
    const imageArtifacts = useMemo(
        () => Object.values(artifacts)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        [artifacts],
    );
    const generatedArtifacts = imageArtifacts.filter((artifact) => artifact.origin === 'generated');
    const sourceArtifactIds = new Set(
        canvasSelectedArtifactUse === 'edit_target' ? canvasSelectedArtifactIds : [],
    );
    const sourceArtifacts = imageArtifacts.filter((artifact) => sourceArtifactIds.has(artifact.id));

    const selectArtifactForIntent = useCallback((artifactId: string, intent: SessionIntent) => {
        setSessionIntent(intent);
        setCanvasArtifactSelection([artifactId], 'edit_target');
    }, [setCanvasArtifactSelection, setSessionIntent]);

    const handleUseAsReference = useCallback((artifactId: string) => {
        setCanvasArtifactSelection([artifactId], 'context');
    }, [setCanvasArtifactSelection]);

    return (
        <div className="flex h-full flex-col bg-slate-50 text-slate-900">
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-blue-600" />
                        <h2 className="truncate text-sm font-semibold">Image Workspace</h2>
                    </div>
                    <p className="truncate text-xs text-slate-400">{getWorkspaceSubtitle(sessionIntent)}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <ImageCanvasViewSwitch value="workspace" onChange={onChangeView} />
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                        {imageArtifacts.length} image{imageArtifacts.length === 1 ? '' : 's'}
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {sourceArtifacts.length > 0 && (
                    <div className="mb-5">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <Check className="h-3.5 w-3.5 text-blue-600" />
                            Source
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {sourceArtifacts.map((artifact) => (
                                <WorkspaceImageCard
                                    key={artifact.id}
                                    artifact={artifact}
                                    isSource
                                    onPreview={onPreview}
                                    onUseAsSource={(artifactId) => selectArtifactForIntent(artifactId, 'image_edit')}
                                    onFitStyle={(artifactId) => selectArtifactForIntent(artifactId, 'style_fit')}
                                    onMakeVariants={(artifactId) => selectArtifactForIntent(artifactId, 'variants')}
                                    onUseAsReference={handleUseAsReference}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {imageArtifacts.length === 0 ? (
                    <div className="flex min-h-full items-center justify-center p-8">
                        <div className="max-w-sm text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300">
                                <ImageIcon className="h-5 w-5" />
                            </div>
                            <h3 className="mt-4 text-sm font-semibold text-slate-700">No images yet</h3>
                            <p className="mt-1 text-sm text-slate-500">Generate, upload, or choose an image to start building variants.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                                Outputs
                            </div>
                            {generatedArtifacts.length > 0 && (
                                <span className="text-xs text-slate-400">
                                    {generatedArtifacts.length} generated
                                </span>
                            )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {imageArtifacts.map((artifact) => (
                                <WorkspaceImageCard
                                    key={artifact.id}
                                    artifact={artifact}
                                    isSource={sourceArtifactIds.has(artifact.id)}
                                    onPreview={onPreview}
                                    onUseAsSource={(artifactId) => selectArtifactForIntent(artifactId, 'image_edit')}
                                    onFitStyle={(artifactId) => selectArtifactForIntent(artifactId, 'style_fit')}
                                    onMakeVariants={(artifactId) => selectArtifactForIntent(artifactId, 'variants')}
                                    onUseAsReference={handleUseAsReference}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function ImageCanvas() {
    const { artifacts, nodes: storeNodes, sessionIntent } = useGraphStore();
    const [imageCanvasView, setImageCanvasView] = useState<ImageCanvasView>('workspace');
    const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
    const previewArtifact = previewArtifactId ? artifacts[previewArtifactId] : undefined;
    const previewSource = previewArtifact ? getImageSource(previewArtifact) : '';
    const previewNavigation = useMemo(
        () => previewArtifactId ? buildImagePreviewNavigation(storeNodes, artifacts, previewArtifactId) : undefined,
        [artifacts, previewArtifactId, storeNodes],
    );
    const isImageIntent = isImageWorkspaceIntent(sessionIntent);
    const handlePreview = useCallback((artifactId: string) => {
        setPreviewArtifactId(artifactId);
    }, []);
    const isEmptyCanvas = Object.keys(storeNodes).length === 0 && Object.keys(artifacts).length === 0;

    if (isEmptyCanvas) {
        return <CanvasStarterBoard />;
    }

    return (
        <>
            {isImageIntent && imageCanvasView === 'workspace' ? (
                <ImageWorkspace onPreview={handlePreview} onChangeView={setImageCanvasView} />
            ) : (
                <ReactFlowProvider>
                    <ArtifactFlow
                        onPreview={handlePreview}
                        headerActions={isImageIntent ? (
                            <ImageCanvasViewSwitch value="timeline" onChange={setImageCanvasView} />
                        ) : undefined}
                    />
                </ReactFlowProvider>
            )}
            {previewArtifact && (
                <ImagePreviewOverlay
                    artifact={previewArtifact}
                    imageSource={previewSource}
                    navigation={previewNavigation}
                    onNavigate={setPreviewArtifactId}
                    onClose={() => setPreviewArtifactId(null)}
                />
            )}
        </>
    );
}
