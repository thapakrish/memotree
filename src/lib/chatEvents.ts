import type { ChatEvent, MessageNode } from '../store/types';
import { stripGeneratedImagePlaceholders } from './generatedImagePlaceholders';

export function appendEvent(events: ChatEvent[], nextEvent: ChatEvent): ChatEvent[] {
    if (nextEvent.kind === 'text' || nextEvent.kind === 'thought') {
        const previous = events.at(-1);
        if (
            previous &&
            previous.kind === nextEvent.kind &&
            ('signature' in previous ? previous.signature : undefined) === ('signature' in nextEvent ? nextEvent.signature : undefined)
        ) {
            const mergedText = previous.text + nextEvent.text;
            return [
                ...events.slice(0, -1),
                nextEvent.kind === 'thought'
                    ? {
                        kind: 'thought',
                        text: mergedText,
                        signature: nextEvent.signature,
                        tokenCount: nextEvent.tokenCount ?? (previous.kind === 'thought' ? previous.tokenCount : undefined),
                    }
                    : {
                        kind: 'text',
                        text: mergedText,
                    },
            ];
        }
    }

    if (nextEvent.kind === 'image_artifact') {
        const duplicate = events.some((event) =>
            event.kind === 'image_artifact'
            && (
                (event.artifact.artifactId && event.artifact.artifactId === nextEvent.artifact.artifactId)
                || (event.artifact.data && nextEvent.artifact.data && event.artifact.data === nextEvent.artifact.data)
            ),
        );
        if (duplicate) {
            return events;
        }
    }

    return [...events, nextEvent];
}

export function mergeEvents(currentEvents: ChatEvent[], nextEvents: ChatEvent[]): ChatEvent[] {
    return nextEvents.reduce((acc, event) => appendEvent(acc, event), currentEvents);
}

export function getFinalAnswerText(events?: ChatEvent[]): string {
    if (!events) return '';

    return events
        .filter((event) => event.kind === 'text')
        .map((event) => stripGeneratedImagePlaceholders(event.text))
        .join('')
        .trim();
}

export function getFirstThought(events?: ChatEvent[]): ChatEvent | undefined {
    return events?.find((event) => event.kind === 'thought');
}

export function getImageArtifacts(events?: ChatEvent[]) {
    return (events ?? []).flatMap((event) => event.kind === 'image_artifact' ? [event.artifact] : []);
}

export function getNodeSummary(node: Pick<MessageNode, 'role' | 'events' | 'content' | 'kind' | 'mergeContext'>): string {
    if (node.role !== 'assistant') {
        return node.content;
    }

    const finalText = getFinalAnswerText(node.events);
    if (finalText) {
        return finalText.length > 40 ? `${finalText.slice(0, 40)}...` : finalText;
    }

    const toolResult = node.events?.find((event) => event.kind === 'tool_result');
    if (toolResult && toolResult.kind === 'tool_result') {
        return toolResult.summary.length > 40 ? `${toolResult.summary.slice(0, 40)}...` : toolResult.summary;
    }

    const firstThought = getFirstThought(node.events);
    if (firstThought && firstThought.kind === 'thought') {
        return firstThought.text.length > 40 ? `${firstThought.text.slice(0, 40)}...` : firstThought.text;
    }

    const imageArtifacts = getImageArtifacts(node.events);
    if (imageArtifacts.length > 0) {
        return `Generated ${imageArtifacts.length} image${imageArtifacts.length === 1 ? '' : 's'}`;
    }

    return node.content || 'Tool ran with no user-facing answer';
}

export function getNodeBadges(node: Pick<MessageNode, 'events' | 'memoryPatches' | 'kind' | 'mergeContext' | 'inferenceMetadata'>): string[] {
    const badges = new Set<string>();

    if (node.kind === 'merge' || node.mergeContext) {
        badges.add('merge');
    }

    if (node.inferenceMetadata?.inferred) {
        badges.add('inferred');
    }

    for (const event of node.events ?? []) {
        if (event.kind === 'thought') badges.add('thinking');
        if (event.kind === 'tool_call' || event.kind === 'tool_result') badges.add('tool');
        if (event.kind === 'tool_result' && event.status === 'error') badges.add('error');
        if (event.kind === 'image_artifact') badges.add('image');
    }

    if ((node.memoryPatches?.length ?? 0) > 0) badges.add('memory');

    return [...badges];
}
