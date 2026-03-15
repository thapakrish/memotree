import type { ChatEvent, MessageNode } from '../store/types';

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

    return [...events, nextEvent];
}

export function mergeEvents(currentEvents: ChatEvent[], nextEvents: ChatEvent[]): ChatEvent[] {
    return nextEvents.reduce((acc, event) => appendEvent(acc, event), currentEvents);
}

export function getFinalAnswerText(events?: ChatEvent[]): string {
    if (!events) return '';

    return events
        .filter((event) => event.kind === 'text')
        .map((event) => event.text)
        .join('')
        .trim();
}

export function getFirstThought(events?: ChatEvent[]): ChatEvent | undefined {
    return events?.find((event) => event.kind === 'thought');
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

    return node.content || 'Tool ran with no user-facing answer';
}

export function getNodeBadges(node: Pick<MessageNode, 'events' | 'memoryPatches' | 'kind' | 'mergeContext'>): string[] {
    const badges = new Set<string>();

    if (node.kind === 'merge' || node.mergeContext) {
        badges.add('merge');
    }

    for (const event of node.events ?? []) {
        if (event.kind === 'thought') badges.add('thinking');
        if (event.kind === 'tool_call' || event.kind === 'tool_result') badges.add('tool');
        if (event.kind === 'tool_result' && event.status === 'error') badges.add('error');
    }

    if (node.memoryPatches.length > 0) badges.add('memory');

    return [...badges];
}
