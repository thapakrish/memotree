import dagre from 'dagre';
import { Position, type Node, type Edge } from '@xyflow/react';
import type { GraphUiPosition } from '../store/types';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 250;
const nodeHeight = 100;

export const getLayoutedElements = (
    nodes: Node[],
    edges: Edge[],
    direction = 'TB',
    savedPositions: Record<string, GraphUiPosition> = {},
    nodeSize: { width: number; height: number } = { width: nodeWidth, height: nodeHeight },
) => {
    const isHorizontal = direction === 'LR';
    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeSize.width, height: nodeSize.height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const newNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const newNode = {
            ...node,
            targetPosition: isHorizontal ? Position.Left : Position.Top,
            sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
            // We are shifting the dagre node position (anchor=center center) to the top left
            // so it matches the React Flow node anchor point (top left).
            position: savedPositions[node.id] ?? {
                x: nodeWithPosition.x - nodeSize.width / 2,
                y: nodeWithPosition.y - nodeSize.height / 2,
            },
        };

        return newNode;
    });

    return { nodes: newNodes, edges };
};
