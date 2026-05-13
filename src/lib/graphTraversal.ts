import type { MessageNode } from '../store/types';

export function collectNodeSubtreeIds(nodes: Record<string, MessageNode>, rootIds: string[]): Set<string> {
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

export function getNearestVisibleNodeId(
    nodes: Record<string, MessageNode>,
    activeNodeId: string | null,
    rootId: string | null,
    hiddenNodeIds: Set<string>,
): string | null {
    let cursor = activeNodeId;
    while (cursor) {
        const node = nodes[cursor];
        if (!node) {
            break;
        }

        if (!hiddenNodeIds.has(cursor)) {
            return cursor;
        }

        cursor = node.parentId;
    }

    if (rootId && nodes[rootId] && !hiddenNodeIds.has(rootId)) {
        return rootId;
    }

    return Object.keys(nodes).find((id) => !hiddenNodeIds.has(id)) ?? null;
}
