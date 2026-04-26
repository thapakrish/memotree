import {
    GoogleGenAI,
    type Content,
    type FunctionCall,
    type FunctionDeclaration,
    type GenerateContentResponse,
    Modality,
    type Part,
    createModelContent,
    createPartFromFunctionResponse,
    createUserContent,
} from '@google/genai';
import type { AttachmentPart, ChatEvent, CompactionBlock, MessageNode, MemoryPatch } from '../store/types';
import type { ProviderRequestConfig } from './providers/types';
import { computePatch, validateEaseMemory } from './memoryEngine';
import { getFinalAnswerText, getImageArtifacts } from './chatEvents';
import { stripGeneratedImagePlaceholders } from './generatedImagePlaceholders';

let geminiClient: GoogleGenAI | null = null;
let activeApiKey: string | null = null;
const TEXT_RESPONSE_MODEL = 'gemini-2.5-flash';
const IMAGE_RESPONSE_MODEL = 'gemini-2.5-flash-image';

export const initGemini = (apiKey: string) => {
    if (!geminiClient || activeApiKey !== apiKey) {
        geminiClient = new GoogleGenAI({ apiKey });
        activeApiKey = apiKey;
    }

    return geminiClient;
};

export const TEXT_EDITOR_TOOL: FunctionDeclaration = {
    name: 'text_editor',
    description: 'Edit the /memories filesystem to store persistent facts across conversations. NEVER use JSON arrays, only key-value dictionaries (EASE protocol).',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                enum: ['create', 'str_replace'],
                description: "The edit operation to perform. Must be strictly 'create' or 'str_replace'.",
            },
            path: {
                type: 'string',
                description: 'Absolute path in the /memories/ directory, e.g. /memories/facts.json.',
            },
            file_text: {
                type: 'string',
                description: "Complete text content when using the 'create' command.",
            },
            old_str: {
                type: 'string',
                description: "Exact string to replace when using 'str_replace'.",
            },
            new_str: {
                type: 'string',
                description: 'New text to insert in place of old_str.',
            },
        },
        required: ['command', 'path'],
        additionalProperties: false,
    },
};

function isImageResponseMode(requestConfig?: ProviderRequestConfig): boolean {
    return requestConfig?.responseMode === 'image' || requestConfig?.responseMode === 'multimodal';
}

function getResponseModalities(requestConfig?: ProviderRequestConfig): Modality[] | undefined {
    switch (requestConfig?.responseMode) {
        case 'image':
            return [Modality.IMAGE];
        case 'multimodal':
            return [Modality.TEXT, Modality.IMAGE];
        default:
            return undefined;
    }
}

export function getGeminiModelForRequest(requestConfig?: ProviderRequestConfig): string {
    return isImageResponseMode(requestConfig) ? IMAGE_RESPONSE_MODEL : TEXT_RESPONSE_MODEL;
}

export function interceptMemoryTool(
    toolArgs: Record<string, string>,
    currentMemoryState: string,
): { updatedMemory: string; patch: MemoryPatch; validationError?: string } {
    let newText = currentMemoryState;

    if (toolArgs.command === 'create') {
        newText = toolArgs.file_text || '{}';
    } else if (toolArgs.command === 'str_replace') {
        newText = currentMemoryState.replace(toolArgs.old_str, toolArgs.new_str);
    }

    // Validate EASE compliance before committing the patch
    const validationError = validateEaseMemory(newText) ?? undefined;
    if (validationError) {
        // Return current state unchanged; caller should surface the error
        return { updatedMemory: currentMemoryState, patch: { diffText: '' }, validationError };
    }

    const diffText = computePatch(currentMemoryState, newText);
    return {
        updatedMemory: newText,
        patch: { diffText },
    };
}

export function extractAssistantEvents(response: GenerateContentResponse): ChatEvent[] {
    const candidates = response.candidates ?? [];
    let imageOrdinal = 0;

    return candidates.reduce<ChatEvent[]>((acc, candidate, candidateIndex) => {
        const parts = candidate.content?.parts ?? [];
        const imageParts = parts.filter((part) => part.inlineData?.data && part.inlineData.mimeType?.startsWith('image/'));

        if ((candidate.index ?? candidateIndex) === 0) {
            for (const part of parts) {
                if (part.text) {
                    acc.push(
                        part.thought
                            ? {
                                kind: 'thought',
                                text: part.text,
                                signature: part.thoughtSignature,
                                tokenCount: response.usageMetadata?.thoughtsTokenCount,
                            }
                            : {
                                kind: 'text',
                                text: part.text,
                            },
                    );
                }
                if (part.functionCall?.name) {
                    acc.push({
                        kind: 'tool_call',
                        toolName: part.functionCall.name,
                        callId: part.functionCall.id,
                        args: part.functionCall.args ?? {},
                    });
                }
            }
        }

        imageParts.forEach((part) => {
            imageOrdinal += 1;
            acc.push({
                kind: 'image_artifact',
                artifact: {
                    id: crypto.randomUUID(),
                    mimeType: part.inlineData!.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                    data: part.inlineData!.data!,
                    model: response.modelVersion,
                    label: candidates.length > 1 || imageParts.length > 1
                        ? `Generated image ${imageOrdinal}`
                        : undefined,
                },
            });
        });

        return acc;
    }, []);
}

export function extractFunctionCalls(response: GenerateContentResponse): FunctionCall[] {
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
}

export function extractThoughtsTokenCount(response: GenerateContentResponse): number {
    return response.usageMetadata?.thoughtsTokenCount ?? 0;
}

function describeAttachmentForModel(attachment: AttachmentPart, index: number): string {
    const role = attachment.kind === 'image' && attachment.use === 'edit_target'
        ? 'edit_target'
        : 'context';
    const fileRef = attachment.artifactPath ?? attachment.artifactId ?? attachment.name ?? attachment.id;
    const guidance = role === 'edit_target'
        ? 'Use this image as the visual edit target. Preserve every unmentioned visual detail and return the edited image.'
        : 'Use this file as reference context for the user request.';
    return `[attached_file ${index + 1}] kind=${attachment.kind}; role=${role}; ref=${fileRef}; mime=${attachment.mimeType}\n${guidance}`;
}

function toModelParts(node: MessageNode): Part[] {
    if (node.role !== 'assistant') {
        const parts: Part[] = [{ text: node.content }];
        for (const [index, att] of (node.attachments ?? []).entries()) {
            parts.push({ text: describeAttachmentForModel(att, index) });
            if (att.data) {
                parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
            }
        }
        return parts;
    }

    const prefixParts: Part[] = node.mergeContext
        ? [{
            text: `<merge_context>\n${node.mergeContext.envelope}\n</merge_context>`,
        }]
        : [];

    if (node.events && node.events.length > 0) {
        return [
            ...prefixParts,
            ...node.events.flatMap<Part>((event) => {
            switch (event.kind) {
                case 'thought':
                    return [{
                        text: event.text,
                        thought: true,
                        thoughtSignature: event.signature,
                    }];
                case 'text': {
                    const text = stripGeneratedImagePlaceholders(event.text);
                    return text ? [{ text }] : [];
                }
                case 'tool_call':
                    return [{
                        functionCall: {
                            id: event.callId,
                            name: event.toolName,
                            args: event.args,
                        },
                    }];
                case 'tool_result':
                    return [];
                case 'image_artifact':
                    return event.artifact.data
                        ? [{
                            inlineData: {
                                mimeType: event.artifact.mimeType,
                                data: event.artifact.data,
                            },
                        }]
                        : [];
            }
            }),
        ];
    }

    return [...prefixParts, { text: node.content }];
}

function toGeminiContents(chatPath: MessageNode[]): Content[] {
    return chatPath.flatMap((node) => {
        const parts = toModelParts(node);
        return parts.length > 0
            ? [{
                role: node.role === 'assistant' ? 'model' : 'user',
                parts,
            }]
            : [];
    });
}

export function buildGeminiContents(chatPath: MessageNode[]): Content[] {
    return toGeminiContents(chatPath);
}

function buildPendingDraftContent(
    pendingText?: string,
    pendingAttachments?: AttachmentPart[],
): Content[] {
    const hasText = Boolean(pendingText?.trim());
    const hasAttachments = (pendingAttachments?.length ?? 0) > 0;
    if (!hasText && !hasAttachments) {
        return [];
    }

    const parts: Part[] = [];
    if (hasText) {
        parts.push({ text: pendingText!.trim() });
    }
    for (const [index, attachment] of (pendingAttachments ?? []).entries()) {
        parts.push({ text: describeAttachmentForModel(attachment, index) });
        if (attachment.data) {
            parts.push({
                inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.data,
                },
            });
        }
    }
    return [{ role: 'user', parts }];
}

export function buildGeminiContentsWithCompaction(
    chatPath: MessageNode[],
    compactions: Record<string, CompactionBlock>,
): Content[] {
    const blocks = Object.values(compactions);
    if (blocks.length === 0) return toGeminiContents(chatPath);

    const pathNodeIds = new Set(chatPath.map((n) => n.id));

    // Only use blocks where every nodeId is present in this path
    const pathIndexById = new Map(chatPath.map((node, index) => [node.id, index]));
    const applicable = blocks
        .filter((b) => b.nodeIds.every((id) => pathNodeIds.has(id)))
        .sort((left, right) => {
            const leftIndex = pathIndexById.get(left.nodeIds[0]) ?? Number.MAX_SAFE_INTEGER;
            const rightIndex = pathIndexById.get(right.nodeIds[0]) ?? Number.MAX_SAFE_INTEGER;
            return leftIndex - rightIndex;
        });
    if (applicable.length === 0) return toGeminiContents(chatPath);

    const compactedIds = new Set<string>();
    const blockByFirstNode = new Map<string, CompactionBlock>();
    for (const block of applicable) {
        for (const id of block.nodeIds) compactedIds.add(id);
        blockByFirstNode.set(block.nodeIds[0], block);
    }

    const contents: Content[] = [];
    let i = 0;
    while (i < chatPath.length) {
        const node = chatPath[i];
        if (blockByFirstNode.has(node.id)) {
            const block = blockByFirstNode.get(node.id)!;
            contents.push({ role: 'user', parts: [{ text: `[Compacted context summary]\n${block.summary}` }] });
            contents.push({ role: 'model', parts: [{ text: 'Understood. I have the context from the earlier summary.' }] });
            i += block.nodeIds.length;
        } else if (compactedIds.has(node.id)) {
            i++;
        } else {
            const parts = toModelParts(node);
            if (parts.length > 0) {
                contents.push({
                    role: node.role === 'assistant' ? 'model' : 'user',
                    parts,
                });
            }
            i++;
        }
    }
    return contents;
}

export async function compactPathNodes(
    nodes: MessageNode[],
    apiKey: string,
): Promise<string> {
    const client = initGemini(apiKey);
    const transcript = nodes.map((n) => {
        const role = n.role === 'assistant' ? 'Assistant' : 'User';
        const segments: string[] = [];

        if (n.role === 'assistant') {
            const thoughts = (n.events ?? [])
                .filter((event) => event.kind === 'thought')
                .map((event) => event.text.trim())
                .filter(Boolean);
            const toolCalls = (n.events ?? [])
                .filter((event) => event.kind === 'tool_call')
                .map((event) => `${event.toolName}(${JSON.stringify(event.args)})`);
            const toolResults = (n.events ?? [])
                .filter((event) => event.kind === 'tool_result')
                .map((event) => `${event.summary}${event.payload !== undefined ? ` | payload: ${JSON.stringify(event.payload)}` : ''}`);
            const imageArtifacts = getImageArtifacts(n.events ?? []);
            const finalText = getFinalAnswerText(n.events ?? []) || n.content;

            if (thoughts.length > 0) {
                segments.push(`Thought summaries: ${thoughts.join(' | ')}`);
            }
            if (toolCalls.length > 0) {
                segments.push(`Tool calls: ${toolCalls.join(' ; ')}`);
            }
            if (toolResults.length > 0) {
                segments.push(`Tool results: ${toolResults.join(' ; ')}`);
            }
            if (imageArtifacts.length > 0) {
                segments.push(`Generated images: ${imageArtifacts.length}`);
            }
            if (finalText.trim()) {
                segments.push(`Reply: ${finalText}`);
            }
        } else {
            if (n.content.trim()) {
                segments.push(`Text: ${n.content}`);
            }
            if ((n.attachments?.length ?? 0) > 0) {
                segments.push(`Attachments: ${n.attachments!.map((attachment) => `${attachment.kind}:${attachment.mimeType}${attachment.name ? ` (${attachment.name})` : ''}`).join(', ')}`);
            }
        }

        if ((n.memoryPatches?.length ?? 0) > 0) {
            segments.push(`Memory patches: ${n.memoryPatches.map((patch) => patch.diffText).join(' || ')}`);
        }

        return `${role}: ${segments.join('\n')}`.trim();
    }).join('\n\n');

    const response = await client.models.generateContent({
        model: TEXT_RESPONSE_MODEL,
        contents: createUserContent([{
            text: `Summarize this conversation segment concisely for context compaction. Preserve all important facts, decisions, attachments, tool calls, tool results, memory updates, and context needed to continue the conversation naturally. Write in past tense. Omit pleasantries, but do not omit technical or factual details that later turns may rely on.\n\n${transcript}`,
        }]),
        config: { thinkingConfig: { includeThoughts: false } },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

export function buildSystemInstruction(memoryState: string, requestConfig?: ProviderRequestConfig): string {
    return `You are MemoTree AI.
${isImageResponseMode(requestConfig)
        ? 'This turn may generate or edit images. Use the active branch context and any attached images precisely. If an attached file is marked role=edit_target, produce an image output that edits that target rather than replying with text only.'
        : 'You have access to a text_editor tool to save long-term facts in /memories/.'}
<memory_files>
/memories/facts.json:
${memoryState}
</memory_files>
CRITICAL: EASE Protocol active. No JSON arrays allowed in memory files. Use key-value only.`;
}

function getGenerationConfig(memoryState: string, requestConfig?: ProviderRequestConfig) {
    const isImageTurn = isImageResponseMode(requestConfig);
    const responseModalities = getResponseModalities(requestConfig);

    return {
        systemInstruction: buildSystemInstruction(memoryState, requestConfig),
        ...(isImageTurn ? {} : {
            tools: [{
                functionDeclarations: [TEXT_EDITOR_TOOL],
            }],
        }),
        ...(!isImageTurn ? {
            thinkingConfig: {
                includeThoughts: true,
            },
        } : {}),
        ...(responseModalities ? { responseModalities } : {}),
    };
}

export async function countTokens(
    chatPath: MessageNode[],
    memoryState: string,
    apiKey: string,
    compactions?: Record<string, CompactionBlock>,
    pendingText?: string,
    pendingAttachments?: AttachmentPart[],
    requestConfig?: ProviderRequestConfig,
): Promise<number> {
    const client = initGemini(apiKey);
    const response = await client.models.countTokens({
        model: getGeminiModelForRequest(requestConfig),
        contents: [
            ...buildGeminiContentsWithCompaction(chatPath, compactions ?? {}),
            ...buildPendingDraftContent(pendingText, pendingAttachments),
        ],
        config: getGenerationConfig(memoryState, requestConfig),
    });
    return response.totalTokens ?? 0;
}

async function* abortableStream(
    stream: AsyncGenerator<GenerateContentResponse>,
    signal: AbortSignal,
): AsyncGenerator<GenerateContentResponse> {
    let aborted = signal.aborted;
    const handleAbort = () => {
        aborted = true;
        void stream.return?.(undefined);
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    try {
        for await (const chunk of stream) {
            if (aborted) {
                await stream.return?.(undefined);
                return;
            }
            yield chunk;
        }
    } finally {
        signal.removeEventListener('abort', handleAbort);
        if (aborted) {
            await stream.return?.(undefined);
        }
    }
}

export async function generateGeminiResponseStreamFromContents(
    contents: Content[],
    memoryState: string,
    apiKey: string,
    signal?: AbortSignal,
    requestConfig?: ProviderRequestConfig,
) {
    const client = initGemini(apiKey);

    const stream = await client.models.generateContentStream({
        model: getGeminiModelForRequest(requestConfig),
        contents,
        config: getGenerationConfig(memoryState, requestConfig),
    });

    if (signal) {
        return abortableStream(stream, signal);
    }

    return stream;
}

export async function generateGeminiResponseStream(
    chatPath: MessageNode[],
    memoryState: string,
    apiKey: string,
    signal?: AbortSignal,
    compactions?: Record<string, CompactionBlock>,
    requestConfig?: ProviderRequestConfig,
) {
    return generateGeminiResponseStreamFromContents(
        buildGeminiContentsWithCompaction(chatPath, compactions ?? {}),
        memoryState,
        apiKey,
        signal,
        requestConfig,
    );
}

export function createModelToolCallContent(
    events: ChatEvent[],
    functionCalls: FunctionCall[],
): Content {
    const parts: Part[] = [
        ...events.flatMap<Part>((event) => {
            switch (event.kind) {
                case 'thought':
                    return [{
                        text: event.text,
                        thought: true,
                        thoughtSignature: event.signature,
                    }];
                case 'text': {
                    const text = stripGeneratedImagePlaceholders(event.text);
                    return text ? [{ text }] : [];
                }
                case 'tool_call':
                case 'tool_result':
                    return [];
                case 'image_artifact':
                    return event.artifact.data
                        ? [{
                            inlineData: {
                                mimeType: event.artifact.mimeType,
                                data: event.artifact.data,
                            },
                        }]
                        : [];
            }
        }),
        ...functionCalls.map((call) => ({
            functionCall: {
                id: call.id,
                name: call.name,
                args: call.args,
            },
        })),
    ];

    return createModelContent(parts);
}

export function createFunctionResponseContent(
    responses: Array<{ id?: string; name: string; response: Record<string, unknown> }>,
): Content {
    const parts = responses.map((response) => createPartFromFunctionResponse(
        response.id ?? '',
        response.name,
        response.response,
    ));

    return createUserContent(parts);
}

export function getAssistantText(events: ChatEvent[]): string {
    return getFinalAnswerText(events);
}
