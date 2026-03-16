import type { Content } from '@google/genai';
import type {
    BranchCapsule,
    MergeContext,
    MergeContextMode,
    MessageNode,
} from '../store/types';
import { getFinalAnswerText, getNodeSummary } from './chatEvents';

function getPathByParentId(nodes: Record<string, MessageNode>, nodeId: string): MessageNode[] {
    const path: MessageNode[] = [];
    let currentId: string | null = nodeId;

    while (currentId && nodes[currentId]) {
        path.unshift(nodes[currentId]);
        currentId = nodes[currentId].parentId;
    }

    return path;
}

function getCommonPrefixLength(pathA: MessageNode[], pathB: MessageNode[]): number {
    const maxLength = Math.min(pathA.length, pathB.length);
    let index = 0;

    while (index < maxLength && pathA[index].id === pathB[index].id) {
        index += 1;
    }

    return index;
}

function getArtifactLines(node: MessageNode): string[] {
    const artifactLines: string[] = [];

    for (const event of node.events ?? []) {
        if (event.kind === 'tool_result') {
            artifactLines.push(`${event.toolName}: ${event.summary}`);
        }
    }

    if ((node.memoryPatches?.length ?? 0) > 0) {
        artifactLines.push(`memory updates: ${node.memoryPatches.length}`);
    }

    return artifactLines;
}

function getNodeBody(node: MessageNode): string {
    if (node.role === 'user') {
        return node.content;
    }

    const text = getFinalAnswerText(node.events);
    if (text) {
        return text;
    }

    const thought = node.events?.find((event) => event.kind === 'thought');
    if (thought && thought.kind === 'thought') {
        return thought.text;
    }

    return node.content;
}

function formatCapsuleBody(nodes: MessageNode[], mode: MergeContextMode): string {
    if (nodes.length === 0) {
        return 'No divergent work on this branch.';
    }

    if (mode === 'full') {
        return nodes
            .map((node) => `${node.role.toUpperCase()}: ${getNodeBody(node)}`)
            .join('\n');
    }

    if (mode === 'artifacts') {
        const finalNode = nodes[nodes.length - 1];
        const artifacts = nodes.flatMap(getArtifactLines);
        return [
            `Final output: ${getNodeBody(finalNode)}`,
            ...(artifacts.length > 0 ? ['Artifacts:', ...artifacts.map((line) => `- ${line}`)] : []),
        ].join('\n');
    }

    return nodes
        .map((node) => {
            const summary = getNodeSummary(node);
            const artifacts = getArtifactLines(node);
            return [
                `${node.role.toUpperCase()}: ${summary}`,
                ...artifacts.map((line) => `- ${line}`),
            ].join('\n');
        })
        .join('\n');
}

function buildBranchCapsule(
    label: string,
    nodes: MessageNode[],
    mode: MergeContextMode,
): BranchCapsule {
    const finalNode = nodes[nodes.length - 1];
    return {
        sourceNodeId: finalNode?.id ?? crypto.randomUUID(),
        label,
        mode,
        pathNodeIds: nodes.map((node) => node.id),
        summary: finalNode ? getNodeSummary(finalNode) : 'No branch output',
        finalOutput: finalNode ? getNodeBody(finalNode) : 'No branch output',
        artifactLines: nodes.flatMap(getArtifactLines),
        body: formatCapsuleBody(nodes, mode),
    };
}

function buildEnvelope(mergeContext: Omit<MergeContext, 'envelope'>): string {
    return [
        'Merged branch context for future reasoning.',
        `Instruction: ${mergeContext.instruction}`,
        `Mode: ${mergeContext.mode}`,
        '',
        `${mergeContext.branchCapsules[0].label}`,
        mergeContext.branchCapsules[0].body,
        '',
        `${mergeContext.branchCapsules[1].label}`,
        mergeContext.branchCapsules[1].body,
        '',
        'Use the branch capsules as curated context. Do not assume omitted branch details remain available unless stated here.',
    ].join('\n');
}

export function buildMergeContext(
    nodes: Record<string, MessageNode>,
    sourceNodeIds: [string, string],
    instruction: string,
    mode: MergeContextMode,
): {
    mergeContext: MergeContext;
    commonPath: MessageNode[];
    divergentPaths: [MessageNode[], MessageNode[]];
    commonAncestorId: string | null;
} {
    const pathA = getPathByParentId(nodes, sourceNodeIds[0]);
    const pathB = getPathByParentId(nodes, sourceNodeIds[1]);
    const commonPrefixLength = getCommonPrefixLength(pathA, pathB);
    const commonPath = pathA.slice(0, commonPrefixLength);
    const divergentA = pathA.slice(commonPrefixLength);
    const divergentB = pathB.slice(commonPrefixLength);
    const commonAncestorId = commonPath.at(-1)?.id ?? null;

    const draftMergeContext = {
        commonAncestorId,
        sourceNodeIds,
        mode,
        instruction,
        branchCapsules: [
            buildBranchCapsule('Branch A', divergentA.length > 0 ? divergentA : [pathA[pathA.length - 1]], mode),
            buildBranchCapsule('Branch B', divergentB.length > 0 ? divergentB : [pathB[pathB.length - 1]], mode),
        ] as [BranchCapsule, BranchCapsule],
    };

    return {
        mergeContext: {
            ...draftMergeContext,
            envelope: buildEnvelope(draftMergeContext),
        },
        commonPath,
        divergentPaths: [divergentA, divergentB],
        commonAncestorId,
    };
}

export function buildMergeRequestContents(
    mergeContext: MergeContext,
    commonPathContents: Content[],
): Content[] {
    return [
        ...commonPathContents,
        {
            role: 'user',
            parts: [{
                text: [
                    'You are merging two conversation branches.',
                    mergeContext.envelope,
                    '',
                    'Do not call tools unless absolutely necessary. Prefer answering directly from the provided branch context.',
                    '',
                    'Produce a single assistant response that correctly uses both branches.',
                    `Merge request: ${mergeContext.instruction}`,
                ].join('\n'),
            }],
        },
    ];
}

export function isMergeableAssistant(node: MessageNode | undefined): boolean {
    return !!node && node.role === 'assistant';
}
