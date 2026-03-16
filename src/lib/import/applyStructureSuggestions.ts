import type { MessageNode, StructureSuggestion } from '../../store/types';

function cloneNode(node: MessageNode): MessageNode {
    return {
        ...node,
        parentIds: node.parentIds ? [...node.parentIds] : undefined,
        groupIds: node.groupIds ? [...node.groupIds] : undefined,
        memoryPatches: [...node.memoryPatches],
        events: node.events ? [...node.events] : undefined,
        inferenceMetadata: node.inferenceMetadata ? { ...node.inferenceMetadata } : undefined,
    };
}

function getImportedNodesByTurnIndex(nodes: Record<string, MessageNode>) {
    return Object.values(nodes)
        .filter((node) => node.importMetadata?.origin === 'imported' && typeof node.importMetadata.sourceTurnIndex === 'number')
        .sort((left, right) => (left.importMetadata?.sourceTurnIndex ?? 0) - (right.importMetadata?.sourceTurnIndex ?? 0));
}

function getImportedNodeAtTurnIndex(
    nodesByTurnIndex: Map<number, MessageNode>,
    turnIndex: number,
    role?: MessageNode['role'],
) {
    const node = nodesByTurnIndex.get(turnIndex);
    if (!node) {
        return null;
    }

    if (role && node.role !== role) {
        return null;
    }

    return node;
}

function getAnchorNodeId(nodesByTurnIndex: Map<number, MessageNode>, anchorTurnIndex: number) {
    const assistantNode = getImportedNodeAtTurnIndex(nodesByTurnIndex, anchorTurnIndex + 1, 'assistant');
    if (assistantNode) {
        return assistantNode.id;
    }

    const systemNode = getImportedNodeAtTurnIndex(nodesByTurnIndex, anchorTurnIndex + 1, 'system');
    if (systemNode) {
        return systemNode.id;
    }

    return getImportedNodeAtTurnIndex(nodesByTurnIndex, anchorTurnIndex)?.id ?? null;
}

function getTurnPairNodeIds(nodesByTurnIndex: Map<number, MessageNode>, userTurnIndex: number) {
    const ids: string[] = [];
    const userNode = getImportedNodeAtTurnIndex(nodesByTurnIndex, userTurnIndex, 'user');
    if (!userNode) {
        return ids;
    }

    ids.push(userNode.id);

    const assistantNode = getImportedNodeAtTurnIndex(nodesByTurnIndex, userTurnIndex + 1, 'assistant');
    if (assistantNode) {
        ids.push(assistantNode.id);
    }

    return ids;
}

export function applyAcceptedStructureSuggestions(
    nodes: Record<string, MessageNode>,
    suggestions: StructureSuggestion[] | undefined,
) {
    const nextNodes = Object.fromEntries(
        Object.entries(nodes).map(([id, node]) => [id, cloneNode(node)]),
    );
    const acceptedSuggestions = (suggestions ?? []).filter((suggestion) => suggestion.status === 'accepted');

    if (acceptedSuggestions.length === 0) {
        return {
            nodes: nextNodes,
            appliedSuggestionCount: 0,
        };
    }

    const importedNodes = getImportedNodesByTurnIndex(nextNodes);
    for (const node of importedNodes) {
        nextNodes[node.id] = {
            ...nextNodes[node.id],
            parentIds: undefined,
            inferenceMetadata: undefined,
        };
    }
    const nodesByTurnIndex = new Map<number, MessageNode>();
    for (const node of importedNodes) {
        const turnIndex = node.importMetadata?.sourceTurnIndex;
        if (typeof turnIndex === 'number' && !nodesByTurnIndex.has(turnIndex)) {
            nodesByTurnIndex.set(turnIndex, node);
        }
    }

    let appliedSuggestionCount = 0;

    for (const suggestion of acceptedSuggestions) {
        const targetTurnIndexes = suggestion.turnIds
            .map((turnId) => Number.parseInt(turnId, 10))
            .filter((turnIndex) => Number.isInteger(turnIndex));

        let changed = false;

        for (const turnIndex of targetTurnIndexes) {
            const userNode = getImportedNodeAtTurnIndex(nodesByTurnIndex, turnIndex, 'user');
            if (!userNode) {
                continue;
            }

            const pairNodeIds = getTurnPairNodeIds(nodesByTurnIndex, turnIndex);
            for (const nodeId of pairNodeIds) {
                const currentNode = nextNodes[nodeId];
                nextNodes[nodeId] = {
                    ...currentNode,
                    inferenceMetadata: {
                        inferred: true,
                        inferenceMethod: suggestion.inferenceMethod,
                        confidence: suggestion.confidence,
                        rationale: suggestion.rationale,
                        suggestionId: suggestion.id,
                        confirmedByUser: true,
                    },
                };
            }

            if (suggestion.kind === 'resume_link' && suggestion.anchorTurnId) {
                const anchorTurnIndex = Number.parseInt(suggestion.anchorTurnId, 10);
                if (!Number.isInteger(anchorTurnIndex)) {
                    continue;
                }

                const nextParentId = getAnchorNodeId(nodesByTurnIndex, anchorTurnIndex);
                if (nextParentId && nextParentId !== userNode.parentId) {
                    const originalParentId = nextNodes[userNode.id].parentId;
                    nextNodes[userNode.id] = {
                        ...nextNodes[userNode.id],
                        parentId: nextParentId,
                        parentIds: [nextParentId, originalParentId].filter(
                            (parentId, index, parentIds): parentId is string =>
                                typeof parentId === 'string' && parentIds.indexOf(parentId) === index,
                        ),
                    };
                    changed = true;
                }
                continue;
            }

            changed = true;
        }

        if (changed) {
            appliedSuggestionCount += 1;
        }
    }

    return {
        nodes: nextNodes,
        appliedSuggestionCount,
    };
}
