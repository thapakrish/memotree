import {
    Background,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Edge,
    type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, ImageIcon, Maximize2, MessageSquare, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getImageArtifacts } from '../lib/chatEvents';
import { getImageSource } from '../lib/artifactStorage';
import type { AttachmentPart, ImageFileArtifact, MessageNode } from '../store/types';
import { useGraphStore } from '../store/useGraphStore';

const IMAGE_NODE_WIDTH = 520;
const IMAGE_NODE_HEIGHT = 450;
const IMAGE_PREVIEW_HEIGHT = 360;
const OPERATION_NODE_WIDTH = 320;
const MIN_ROW_HEIGHT = 560;
const INPUT_X = 64;
const OPERATION_X = 680;
const OUTPUT_X = 1088;

function formatBytes(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getImageArtifactIdFromAttachment(attachment: AttachmentPart): string | null {
    return attachment.kind === 'image' && attachment.artifactId ? attachment.artifactId : null;
}

interface ImageNodeData {
    artifact: ImageFileArtifact;
    imageSource: string;
    label: string;
    isSelected: boolean;
    onPreview: (artifactId: string) => void;
    onToggleSelection: (artifactId: string) => void;
}

interface OperationNodeData {
    title: string;
    inputCount: number;
    outputCount: number;
    isActive: boolean;
    onActivate: () => void;
}

interface ImageArtifactNodeProps {
    data: ImageNodeData;
}

function ImageArtifactNode({ data }: ImageArtifactNodeProps) {
    return (
        <div
            className={`group overflow-hidden rounded-lg border bg-slate-900 shadow-xl transition-colors ${
                data.isSelected
                    ? 'border-blue-400 shadow-blue-500/20'
                    : 'border-slate-700 hover:border-slate-500'
            }`}
            style={{ width: IMAGE_NODE_WIDTH }}
        >
            <Handle type="target" position={Position.Left} className="h-3 w-3 border-slate-950 bg-blue-400" />
            <div className="relative bg-slate-950" style={{ height: IMAGE_PREVIEW_HEIGHT }}>
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        data.onPreview(data.artifact.id);
                    }}
                    className="flex h-full w-full cursor-zoom-in items-center justify-center"
                    title="Open large preview"
                >
                    {data.imageSource ? (
                        <img
                            src={data.imageSource}
                            alt={data.label}
                            className="max-h-full max-w-full object-contain"
                            loading="lazy"
                        />
                    ) : (
                        <ImageIcon className="h-10 w-10 text-slate-600" />
                    )}
                </button>
                <div className="absolute right-2 top-2 flex gap-1.5">
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            data.onToggleSelection(data.artifact.id);
                        }}
                        className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                            data.isSelected
                                ? 'border-blue-300 bg-blue-500 text-white'
                                : 'border-slate-600 bg-slate-950/80 text-slate-300 hover:border-blue-300 hover:text-blue-300'
                        }`}
                        title="Select image"
                    >
                        <Check className="h-4 w-4" />
                    </button>
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            data.onPreview(data.artifact.id);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-600 bg-slate-950/80 text-slate-300 transition-colors hover:border-blue-300 hover:text-blue-300"
                        title="Open large preview"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                </div>
                <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-slate-950/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                    Click to preview
                </div>
            </div>
            <div className="space-y-1 border-t border-slate-800 px-3 py-3">
                <div className="truncate text-sm font-semibold text-slate-100">{data.label}</div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">{data.artifact.origin}</span>
                    <span>{formatBytes(data.artifact.sizeBytes) || data.artifact.mimeType}</span>
                </div>
            </div>
            <Handle type="source" position={Position.Right} className="h-3 w-3 border-slate-950 bg-blue-400" />
        </div>
    );
}

interface OperationNodeProps {
    data: OperationNodeData;
}

function OperationNode({ data }: OperationNodeProps) {
    return (
        <button
            onClick={(event) => {
                event.stopPropagation();
                data.onActivate();
            }}
            className={`rounded-lg border p-3 text-left shadow-lg transition-colors ${
                data.isActive
                    ? 'border-blue-400 bg-blue-950 text-blue-50 ring-2 ring-blue-500/40'
                    : 'border-slate-700 bg-slate-900 text-slate-100 hover:border-blue-400'
            }`}
            style={{ width: OPERATION_NODE_WIDTH }}
            title="Set active checkpoint"
        >
            <Handle type="target" position={Position.Left} className="h-3 w-3 bg-blue-400" />
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{data.title}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-400">
                <span>{data.inputCount} in</span>
                <span className="h-1 w-1 rounded-full bg-slate-600" />
                <span>{data.outputCount} out</span>
            </div>
            <Handle type="source" position={Position.Right} className="h-3 w-3 bg-blue-400" />
        </button>
    );
}

const nodeTypes = {
    imageArtifact: ImageArtifactNode,
    operation: OperationNode,
};

function buildTurnPairs(path: MessageNode[]) {
    const turns: Array<{ userNode?: MessageNode; assistantNode?: MessageNode }> = [];
    let index = 0;

    while (index < path.length) {
        const node = path[index];
        const nextNode = path[index + 1];
        if (node.role === 'user') {
            const assistantNode = nextNode?.role === 'assistant' && nextNode.parentId === node.id
                ? nextNode
                : undefined;
            turns.push({ userNode: node, assistantNode });
            index += assistantNode ? 2 : 1;
            continue;
        }

        turns.push({ assistantNode: node });
        index += 1;
    }

    return turns;
}

interface ArtifactFlowProps {
    onPreview: (artifactId: string) => void;
}

function ArtifactFlow({ onPreview }: ArtifactFlowProps) {
    const {
        activeNodeId,
        artifacts,
        getPath,
        setActiveNode,
        canvasSelectedArtifactIds,
        toggleCanvasArtifactSelection,
        clearCanvasArtifactSelection,
    } = useGraphStore();
    const { setCenter } = useReactFlow();

    const path = getPath(activeNodeId);
    const selectedCount = canvasSelectedArtifactIds.filter((id) => artifacts[id]).length;

    const { flowNodes, flowEdges, branchImageCount } = useMemo(() => {
        const nodes: Node[] = [];
        const edges: Edge[] = [];
        const pathNodeIds = new Set(path.map((node) => node.id));
        const branchImages = Object.values(artifacts).filter((artifact) =>
            !artifact.sourceNodeId || pathNodeIds.has(artifact.sourceNodeId),
        );
        const renderedImageIds = new Set<string>();
        const turns = buildTurnPairs(path);
        let yOffset = 0;

        const addImageNode = (artifact: ImageFileArtifact, x: number, y: number) => {
            if (renderedImageIds.has(artifact.id)) {
                return;
            }
            renderedImageIds.add(artifact.id);
            nodes.push({
                id: `image-${artifact.id}`,
                type: 'imageArtifact',
                position: { x, y },
                data: {
                    artifact,
                    imageSource: getImageSource(artifact),
                    label: artifact.label ?? artifact.name,
                    isSelected: canvasSelectedArtifactIds.includes(artifact.id),
                    onPreview,
                    onToggleSelection: toggleCanvasArtifactSelection,
                },
            });
        };

        turns.forEach((turn, turnIndex) => {
            const operationSourceNode = turn.assistantNode ?? turn.userNode;
            if (!operationSourceNode) {
                return;
            }

            const inputArtifacts = (turn.userNode?.attachments ?? [])
                .map(getImageArtifactIdFromAttachment)
                .filter((artifactId): artifactId is string => Boolean(artifactId))
                .map((artifactId) => artifacts[artifactId])
                .filter((artifact): artifact is ImageFileArtifact => Boolean(artifact));
            const outputArtifacts = getImageArtifacts(turn.assistantNode?.events)
                .map((artifact) => artifact.artifactId ?? artifact.id)
                .map((artifactId) => artifacts[artifactId])
                .filter((artifact): artifact is ImageFileArtifact => Boolean(artifact));
            const rowImageCount = Math.max(inputArtifacts.length, outputArtifacts.length, 1);
            const rowHeight = Math.max(MIN_ROW_HEIGHT, rowImageCount * (IMAGE_NODE_HEIGHT + 36));
            const rowTop = yOffset;
            const rowCenter = rowTop + rowHeight / 2 - 75;
            const operationId = `operation-${operationSourceNode.id}`;

            nodes.push({
                id: operationId,
                type: 'operation',
                position: { x: OPERATION_X, y: rowCenter },
                data: {
                    title: `Turn ${turnIndex + 1}`,
                    inputCount: inputArtifacts.length,
                    outputCount: outputArtifacts.length,
                    isActive: operationSourceNode.id === activeNodeId || turn.userNode?.id === activeNodeId,
                    onActivate: () => setActiveNode(operationSourceNode.id),
                },
            });

            inputArtifacts.forEach((artifact, inputIndex) => {
                const imageY = rowTop + inputIndex * (IMAGE_NODE_HEIGHT + 36);
                addImageNode(artifact, INPUT_X, imageY);
                const attachment = turn.userNode?.attachments?.find((candidate) => candidate.artifactId === artifact.id);
                edges.push({
                    id: `edge-image-${artifact.id}-${operationId}-${inputIndex}`,
                    source: `image-${artifact.id}`,
                    target: operationId,
                    type: 'smoothstep',
                    style: {
                        stroke: attachment?.use === 'edit_target' ? '#f59e0b' : '#60a5fa',
                        strokeWidth: 3,
                    },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: attachment?.use === 'edit_target' ? '#f59e0b' : '#60a5fa',
                    },
                });
            });

            outputArtifacts.forEach((artifact, outputIndex) => {
                const imageY = rowTop + outputIndex * (IMAGE_NODE_HEIGHT + 36);
                addImageNode(artifact, OUTPUT_X, imageY);
                edges.push({
                    id: `edge-${operationId}-image-${artifact.id}-${outputIndex}`,
                    source: operationId,
                    target: `image-${artifact.id}`,
                    type: 'smoothstep',
                    style: { stroke: '#c084fc', strokeWidth: 3 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#c084fc' },
                });
            });

            yOffset += rowHeight + 80;
        });

        branchImages
            .filter((artifact) => !renderedImageIds.has(artifact.id))
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .forEach((artifact, index) => {
                addImageNode(artifact, OUTPUT_X, yOffset + index * (IMAGE_NODE_HEIGHT + 36));
            });

        return {
            flowNodes: nodes,
            flowEdges: edges,
            branchImageCount: branchImages.length,
        };
    }, [activeNodeId, artifacts, canvasSelectedArtifactIds, onPreview, path, setActiveNode, toggleCanvasArtifactSelection]);

    useEffect(() => {
        const activeOperation = flowNodes.find((node) =>
            node.type === 'operation' && (node.data as unknown as OperationNodeData).isActive,
        );
        if (!activeOperation) {
            return;
        }

        setCenter(activeOperation.position.x + 560, activeOperation.position.y + 170, {
            zoom: 0.78,
            duration: 450,
        });
    }, [flowNodes, setCenter]);

    return (
        <div className="flex h-full flex-col bg-slate-950 text-slate-100">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-blue-300" />
                        <h2 className="truncate text-sm font-semibold">Memo Canvas</h2>
                    </div>
                    <p className="truncate text-xs text-slate-400">
                        {branchImageCount} image node{branchImageCount === 1 ? '' : 's'} on this branch
                    </p>
                </div>
                {selectedCount > 0 && (
                    <button
                        onClick={clearCanvasArtifactSelection}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                        title="Clear canvas selection"
                    >
                        <X className="h-3.5 w-3.5" />
                        {selectedCount} selected
                    </button>
                )}
            </div>

            {flowNodes.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                    <div className="max-w-sm text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-500">
                            <MessageSquare className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-sm font-semibold text-slate-200">No active branch</h3>
                    </div>
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    <ReactFlow
                        nodes={flowNodes}
                        edges={flowEdges}
                        nodeTypes={nodeTypes}
                        defaultViewport={{ x: 20, y: 80, zoom: 0.78 }}
                        minZoom={0.2}
                        maxZoom={1.2}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable={false}
                    >
                        <Background color="#1e293b" gap={24} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                </div>
            )}
        </div>
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
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm"
                    onClick={() => setPreviewArtifactId(null)}
                >
                    <div
                        className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-100">
                                    {previewArtifact.label ?? previewArtifact.name}
                                </div>
                                <div className="truncate text-xs text-slate-500">{previewArtifact.path}</div>
                            </div>
                            <button
                                onClick={() => setPreviewArtifactId(null)}
                                className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                                title="Close preview"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-4">
                            {previewSource ? (
                                <img
                                    src={previewSource}
                                    alt={previewArtifact.label ?? previewArtifact.name}
                                    className="max-h-[78dvh] max-w-full object-contain"
                                />
                            ) : (
                                <ImageIcon className="h-12 w-12 text-slate-700" />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </ReactFlowProvider>
    );
}
