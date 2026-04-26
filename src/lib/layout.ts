import dagre from 'dagre';
import { Position, type Node, type Edge } from '@xyflow/react';
import type { GraphUiPosition } from '../store/types';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 250;
const nodeHeight = 100;

function getNodeLayoutSize(
    node: Node,
    fallback: { width: number; height: number },
): { width: number; height: number } {
    const data = node.data as { layoutSize?: { width: number; height: number } } | undefined;
    return data?.layoutSize ?? fallback;
}

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
        const layoutSize = getNodeLayoutSize(node, nodeSize);
        dagreGraph.setNode(node.id, layoutSize);
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const newNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const layoutSize = getNodeLayoutSize(node, nodeSize);
        const newNode = {
            ...node,
            targetPosition: isHorizontal ? Position.Left : Position.Top,
            sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
            // We are shifting the dagre node position (anchor=center center) to the top left
            // so it matches the React Flow node anchor point (top left).
            position: savedPositions[node.id] ?? {
                x: nodeWithPosition.x - layoutSize.width / 2,
                y: nodeWithPosition.y - layoutSize.height / 2,
            },
        };

        return newNode;
    });

    return { nodes: newNodes, edges };
};
