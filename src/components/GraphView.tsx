import React, { useCallback, useEffect } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    useReactFlow,
    type Node,
    type Edge,
    MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useGraphStore } from '../store/useGraphStore';
import { CustomNode } from './CustomNode';
import { getLayoutedElements } from '../lib/layout';

const nodeTypes = {
    custom: CustomNode,
};

export function GraphView() {
    const { nodes: storeNodes, activeNodeId, setActiveNode } = useGraphStore();

    const [rfNodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [rfEdges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const { setCenter } = useReactFlow();

    // Transform Zustand Graph to React Flow Data
    useEffect(() => {
        const rawNodes: Node[] = [];
        const rawEdges: Edge[] = [];

        Object.values(storeNodes).forEach((node) => {
            rawNodes.push({
                id: node.id,
                type: 'custom',
                position: { x: 0, y: 0 }, // Will be set by dagre
                data: { node, isActive: node.id === activeNodeId },
            });

            if (node.parentId) {
                // Find ancestor path to highlight active branch edges
                // (In this basic version, we just animate the edge strictly pointing to the active node,
                // but robustly we should highlight the whole path to root.)
                rawEdges.push({
                    id: `e-${node.parentId}-${node.id}`,
                    source: node.parentId,
                    target: node.id,
                    type: 'smoothstep',
                    animated: node.id === activeNodeId,
                    style: { stroke: node.id === activeNodeId ? '#3b82f6' : '#cbd5e1', strokeWidth: node.id === activeNodeId ? 3 : 2 },
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: node.id === activeNodeId ? '#3b82f6' : '#cbd5e1',
                    },
                });
            }
        });

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [storeNodes, activeNodeId, setNodes, setEdges]);

    // Auto-pan to active node
    useEffect(() => {
        if (activeNodeId && rfNodes.length > 0) {
            const activeNode = rfNodes.find(n => n.id === activeNodeId);
            if (activeNode) {
                // The position in React Flow is top-left, but we want to center on the middle of the node (approx 250x100 from layout)
                const x = activeNode.position.x + 125; 
                const y = activeNode.position.y + 50;
                setCenter(x, y, { zoom: 1, duration: 800 });
            }
        }
    }, [activeNodeId, rfNodes, setCenter]);

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setActiveNode(node.id);
    }, [setActiveNode]);

    return (
        <div className="w-full h-full bg-slate-50 relative">
            <div className="absolute top-4 left-4 z-10 font-semibold text-slate-700 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
                Memory Tree Map
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
        </div>
    );
}
