import type { IProvider, ProviderCapabilities, ProviderContextEstimate, StreamDelta } from './types';
import type { AttachmentPart, CompactionBlock, MessageNode } from '../../store/types';
import { getFinalAnswerText } from '../chatEvents';

interface OllamaProviderConfig {
    baseUrl: string;
    model: string;
    supportsImages?: boolean;
}

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: string[];
}

interface OllamaChatChunk {
    message?: {
        role?: string;
        content?: string;
    };
    response?: string;
    done?: boolean;
    error?: string;
}

interface OllamaTagsResponse {
    models?: Array<{
        name?: string;
        model?: string;
    }>;
}

interface OllamaShowResponse {
    capabilities?: string[];
}

export interface OllamaModelCapabilities {
    supportsImages: boolean;
    capabilities: string[];
}

const OLLAMA_BASE_CAPABILITIES: Omit<ProviderCapabilities, 'supportsImages' | 'supportsFileAttachments'> = {
    supportsCaching: false,
    supportsThinking: false,
    maxContextTokens: 32_768,
};

function normalizeBaseUrl(baseUrl: string) {
    return baseUrl.replace(/\/+$/, '');
}

function roughTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function buildSystemMessage(memoryState: string): OllamaMessage {
    return {
        role: 'system',
        content: `You are MemoTree AI.
Only use the active conversation branch provided in this request.

Branch-local memory:
${memoryState}`,
    };
}

function buildOllamaCapabilities(supportsImages: boolean): ProviderCapabilities {
    return {
        ...OLLAMA_BASE_CAPABILITIES,
        supportsImages,
        supportsFileAttachments: supportsImages,
    };
}

function attachmentOmittedLine(attachment: AttachmentPart): string {
    return `[Attachment omitted: ${attachment.name ?? attachment.kind} (${attachment.mimeType})]`;
}

function imageAttachments(node: MessageNode): AttachmentPart[] {
    return (node.attachments ?? []).filter((attachment) => attachment.kind === 'image');
}

function omittedAttachments(node: MessageNode, supportsImages: boolean): AttachmentPart[] {
    return (node.attachments ?? []).filter((attachment) => attachment.kind !== 'image' || !supportsImages);
}

function nodeText(node: MessageNode, supportsImages: boolean): string {
    if (node.role === 'assistant') {
        const eventText = node.events ? getFinalAnswerText(node.events) : '';
        return eventText || node.content;
    }

    const attachmentLines = omittedAttachments(node, supportsImages).map(attachmentOmittedLine);

    return [node.content, ...attachmentLines].filter(Boolean).join('\n');
}

function nodeToMessage(node: MessageNode, supportsImages: boolean): OllamaMessage {
    const message: OllamaMessage = {
        role: node.role === 'assistant'
            ? 'assistant'
            : node.role === 'system'
                ? 'system'
                : 'user',
        content: nodeText(node, supportsImages),
    };

    const images = supportsImages && node.role === 'user'
        ? imageAttachments(node).map((attachment) => attachment.data)
        : [];

    return images.length > 0
        ? { ...message, images }
        : message;
}

function buildMessages(
    path: MessageNode[],
    memoryState: string,
    compactions: Record<string, CompactionBlock>,
    supportsImages: boolean,
): OllamaMessage[] {
    const messages: OllamaMessage[] = [buildSystemMessage(memoryState)];
    const blocks = Object.values(compactions);
    if (blocks.length === 0) {
        return [...messages, ...path.map((node) => nodeToMessage(node, supportsImages))];
    }

    const pathNodeIds = new Set(path.map((node) => node.id));
    const pathIndexById = new Map(path.map((node, index) => [node.id, index]));
    const applicableBlocks = blocks
        .filter((block) => block.nodeIds.every((id) => pathNodeIds.has(id)))
        .sort((left, right) => {
            const leftIndex = pathIndexById.get(left.nodeIds[0]) ?? Number.MAX_SAFE_INTEGER;
            const rightIndex = pathIndexById.get(right.nodeIds[0]) ?? Number.MAX_SAFE_INTEGER;
            return leftIndex - rightIndex;
        });

    if (applicableBlocks.length === 0) {
        return [...messages, ...path.map((node) => nodeToMessage(node, supportsImages))];
    }

    const compactedIds = new Set<string>();
    const blockByFirstNode = new Map<string, CompactionBlock>();
    for (const block of applicableBlocks) {
        for (const id of block.nodeIds) {
            compactedIds.add(id);
        }
        blockByFirstNode.set(block.nodeIds[0], block);
    }

    for (let index = 0; index < path.length;) {
        const node = path[index];
        const block = blockByFirstNode.get(node.id);
        if (block) {
            messages.push({
                role: 'system',
                content: `[Compacted active-path context]\n${block.summary}`,
            });
            index += block.nodeIds.length;
            continue;
        }

        if (compactedIds.has(node.id)) {
            index += 1;
            continue;
        }

        messages.push(nodeToMessage(node, supportsImages));
        index += 1;
    }

    return messages;
}

async function postOllamaChat(
    config: OllamaProviderConfig,
    messages: OllamaMessage[],
    stream: boolean,
    signal?: AbortSignal,
) {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.model,
            messages,
            stream,
        }),
        signal,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Ollama request failed (${response.status}): ${text || response.statusText}`);
    }

    return response;
}

async function* streamOllamaResponse(response: Response): AsyncGenerator<StreamDelta> {
    if (!response.body) {
        throw new Error('Ollama response did not include a stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const chunk = JSON.parse(trimmed) as OllamaChatChunk;
            if (chunk.error) {
                throw new Error(chunk.error);
            }

            const nextText = chunk.message?.content ?? chunk.response ?? '';
            if (nextText) {
                text += nextText;
                yield {
                    events: [{ kind: 'text', text }],
                    thoughtsTokenCount: 0,
                    functionCalls: [],
                };
            }
        }
    }

    const trailing = buffer.trim();
    if (trailing) {
        const chunk = JSON.parse(trailing) as OllamaChatChunk;
        if (chunk.error) {
            throw new Error(chunk.error);
        }
        const nextText = chunk.message?.content ?? chunk.response ?? '';
        if (nextText) {
            text += nextText;
        }
    }

    if (text) {
        yield {
            events: [{ kind: 'text', text }],
            thoughtsTokenCount: 0,
            functionCalls: [],
        };
    }
}

function messagesToRoughTokens(messages: OllamaMessage[]) {
    return roughTokens(messages.map((message) => `${message.role}: ${message.content}`).join('\n'));
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Unable to list Ollama models (${response.status}): ${text || response.statusText}`);
    }

    const payload = await response.json() as OllamaTagsResponse;
    return (payload.models ?? [])
        .map((model) => model.name ?? model.model)
        .filter((name): name is string => Boolean(name))
        .sort((left, right) => left.localeCompare(right));
}

export async function getOllamaModelCapabilities(
    baseUrl: string,
    model: string,
    signal?: AbortSignal,
): Promise<OllamaModelCapabilities> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Unable to inspect Ollama model (${response.status}): ${text || response.statusText}`);
    }

    const payload = await response.json() as OllamaShowResponse;
    const capabilities = payload.capabilities ?? [];
    return {
        supportsImages: capabilities.some((capability) => capability.toLowerCase() === 'vision'),
        capabilities,
    };
}

export function createOllamaProvider(config: OllamaProviderConfig): IProvider {
    const supportsImages = Boolean(config.supportsImages);
    const capabilities = buildOllamaCapabilities(supportsImages);

    return {
        id: 'ollama',
        capabilities,

        async *stream(path, memoryState, compactions, signal) {
            const messages = buildMessages(path, memoryState, compactions, supportsImages);
            const response = await postOllamaChat(config, messages, true, signal);
            yield* streamOllamaResponse(response);
        },

        async *continueWithToolResults() {
            yield {
                events: [],
                thoughtsTokenCount: 0,
                functionCalls: [],
            };
        },

        async countTokens(path, memoryState, compactions, pendingText) {
            const messages = buildMessages(path, memoryState, compactions, supportsImages);
            if (pendingText?.trim()) {
                messages.push({ role: 'user', content: pendingText.trim() });
            }
            return messagesToRoughTokens(messages);
        },

        async compactNodes(nodes) {
            const transcript = nodes
                .map((node) => `${node.role.toUpperCase()}: ${nodeText(node, false)}`)
                .join('\n\n');
            const response = await postOllamaChat(config, [{
                role: 'user',
                content: `Summarize this conversation segment for later context. Preserve technical facts, decisions, assumptions, and unresolved questions.\n\n${transcript}`,
            }], false);
            const payload = await response.json() as OllamaChatChunk;
            return payload.message?.content ?? payload.response ?? '';
        },

        estimateContext(memoryState, pendingAttachments): ProviderContextEstimate {
            return {
                cacheableTokens: roughTokens(buildSystemMessage(memoryState).content),
                attachmentTokens: supportsImages
                    ? (pendingAttachments ?? []).filter((attachment) => attachment.kind === 'image').length * 512
                    : 0,
            };
        },
    };
}
