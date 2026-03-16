import type { ConversationGraph, MessageNode } from '../../store/types';

export interface ImportedPathGroup {
    id: string;
    nodeIds: string[];
    parentGroupIds: string[];
    childGroupIds: string[];
    primaryNodeId: string;
    title: string;
    summary: string;
    turnCount: number;
    inferred: boolean;
    startTimestamp: string;
    endTimestamp: string;
}

export function getImportedPathGroupPositionKey(pathGroup: Pick<ImportedPathGroup, 'id'>) {
    return pathGroup.id;
}

function summarizeText(text: string, maxLength = 48) {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= maxLength) {
        return collapsed;
    }

    return `${collapsed.slice(0, maxLength)}...`;
}

function getDisplayParents(node: MessageNode) {
    if (node.parentIds && node.parentIds.length > 0) {
        return node.parentIds;
    }

    return node.parentId ? [node.parentId] : [];
}

function getAcceptedBoundaryTurnIndexes(graph: Pick<ConversationGraph, 'importEnvelope'>) {
    const boundaryTurnIndexes = new Set<number>();

    for (const suggestion of graph.importEnvelope?.suggestions ?? []) {
        if (suggestion.status !== 'accepted') {
            continue;
        }

        if (
            suggestion.kind !== 'reset' &&
            suggestion.kind !== 'resume_link' &&
            suggestion.kind !== 'detour_span' &&
            suggestion.kind !== 'branch_start'
        ) {
            continue;
        }

        for (const turnId of suggestion.turnIds) {
            const turnIndex = Number.parseInt(turnId, 10);
            if (Number.isInteger(turnIndex)) {
                boundaryTurnIndexes.add(turnIndex);
            }
        }
    }

    return boundaryTurnIndexes;
}

function buildChildrenMap(nodes: Record<string, MessageNode>, importedIds: Set<string>) {
    const children = new Map<string, string[]>();

    for (const nodeId of importedIds) {
        const node = nodes[nodeId];
        for (const parentId of getDisplayParents(node)) {
            if (!importedIds.has(parentId)) {
                continue;
            }

            const currentChildren = children.get(parentId) ?? [];
            currentChildren.push(nodeId);
            children.set(parentId, currentChildren);
        }
    }

    return children;
}

function getGroupTitle(nodes: Record<string, MessageNode>, nodeIds: string[]) {
    const firstUser = nodeIds
        .map((nodeId) => nodes[nodeId])
        .find((node) => node.role === 'user');
    const lastAssistant = [...nodeIds]
        .reverse()
        .map((nodeId) => nodes[nodeId])
        .find((node) => node.role === 'assistant');

    if (firstUser?.content) {
        return summarizeText(firstUser.content);
    }

    if (lastAssistant?.summary) {
        return summarizeText(lastAssistant.summary);
    }

    return summarizeText(nodes[nodeIds[0]]?.summary ?? nodes[nodeIds[0]]?.content ?? 'Imported path');
}

function getGroupSummary(nodes: Record<string, MessageNode>, nodeIds: string[]) {
    const firstNode = nodes[nodeIds[0]];
    const lastNode = nodes[nodeIds[nodeIds.length - 1]];
    const firstText = firstNode?.content ? summarizeText(firstNode.content, 36) : '';
    const lastText = lastNode?.summary ? summarizeText(lastNode.summary, 36) : summarizeText(lastNode?.content ?? '', 36);

    if (nodeIds.length === 1) {
        return lastText || firstText;
    }

    if (firstText && lastText && firstText !== lastText) {
        return `${firstText} -> ${lastText}`;
    }

    return lastText || firstText;
}

export function buildImportedPathGroups(graph: Pick<ConversationGraph, 'nodes' | 'importEnvelope'>) {
    if (!graph.importEnvelope) {
        return [];
    }

    const importedIds = new Set(
        Object.values(graph.nodes)
            .filter((node) => node.importMetadata?.origin === 'imported')
            .map((node) => node.id),
    );

    if (importedIds.size === 0) {
        return [];
    }

    const childrenMap = buildChildrenMap(graph.nodes, importedIds);
    const incomingCount = new Map<string, number>();
    const boundaryTurnIndexes = getAcceptedBoundaryTurnIndexes(graph);

    for (const nodeId of importedIds) {
        incomingCount.set(
            nodeId,
            getDisplayParents(graph.nodes[nodeId]).filter((parentId) => importedIds.has(parentId)).length,
        );
    }

    const isSegmentStart = (nodeId: string) => {
        const node = graph.nodes[nodeId];
        const turnIndex = node.importMetadata?.sourceTurnIndex;
        if (typeof turnIndex === 'number' && boundaryTurnIndexes.has(turnIndex)) {
            return true;
        }

        const importedParents = getDisplayParents(node).filter((parentId) => importedIds.has(parentId));

        if (importedParents.length !== 1) {
            return true;
        }

        const [parentId] = importedParents;
        const parentChildren = childrenMap.get(parentId) ?? [];
        return parentChildren.length !== 1;
    };

    const groups: ImportedPathGroup[] = [];
    const nodeToGroupId = new Map<string, string>();
    const visited = new Set<string>();

    const orderedImportedIds = [...importedIds].sort((leftId, rightId) => {
        const leftIndex = graph.nodes[leftId].importMetadata?.sourceTurnIndex ?? 0;
        const rightIndex = graph.nodes[rightId].importMetadata?.sourceTurnIndex ?? 0;
        return leftIndex - rightIndex;
    });

    const createGroupFrom = (startId: string) => {
        const nodeIds: string[] = [];
        let currentId: string | null = startId;

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            nodeIds.push(currentId);

            const children: string[] = (childrenMap.get(currentId) ?? []).filter((childId) => importedIds.has(childId));
            if (children.length !== 1) {
                break;
            }

            const [nextChildId]: string[] = children;
            if ((incomingCount.get(nextChildId) ?? 0) !== 1) {
                break;
            }

            const nextTurnIndex = graph.nodes[nextChildId].importMetadata?.sourceTurnIndex;
            if (typeof nextTurnIndex === 'number' && boundaryTurnIndexes.has(nextTurnIndex)) {
                break;
            }

            currentId = nextChildId;
        }

        const primaryNodeId = nodeIds[nodeIds.length - 1];
        const groupId = `path-${primaryNodeId}`;
        for (const nodeId of nodeIds) {
            nodeToGroupId.set(nodeId, groupId);
        }

        groups.push({
            id: groupId,
            nodeIds,
            parentGroupIds: [],
            childGroupIds: [],
            primaryNodeId,
            title: getGroupTitle(graph.nodes, nodeIds),
            summary: getGroupSummary(graph.nodes, nodeIds),
            turnCount: nodeIds.length,
            inferred: nodeIds.some((nodeId) => Boolean(graph.nodes[nodeId].inferenceMetadata?.inferred)),
            startTimestamp: graph.nodes[nodeIds[0]].timestamp,
            endTimestamp: graph.nodes[primaryNodeId].timestamp,
        });
    };

    for (const nodeId of orderedImportedIds) {
        if (!visited.has(nodeId) && isSegmentStart(nodeId)) {
            createGroupFrom(nodeId);
        }
    }

    for (const nodeId of orderedImportedIds) {
        if (!visited.has(nodeId)) {
            createGroupFrom(nodeId);
        }
    }

    const groupsById = new Map(groups.map((group) => [group.id, group]));

    for (const group of groups) {
        const firstNode = graph.nodes[group.nodeIds[0]];
        const parentGroupIds = new Set<string>();

        for (const parentId of getDisplayParents(firstNode)) {
            const parentGroupId = nodeToGroupId.get(parentId);
            if (parentGroupId && parentGroupId !== group.id) {
                parentGroupIds.add(parentGroupId);
            }
        }

        group.parentGroupIds = [...parentGroupIds];
        for (const parentGroupId of group.parentGroupIds) {
            const parentGroup = groupsById.get(parentGroupId);
            if (parentGroup && !parentGroup.childGroupIds.includes(group.id)) {
                parentGroup.childGroupIds.push(group.id);
            }
        }
    }

    return groups;
}
