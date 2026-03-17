import {
    GoogleGenAI,
    type Content,
    type FunctionCall,
    type FunctionDeclaration,
    type GenerateContentResponse,
    type Part,
    createModelContent,
    createPartFromFunctionResponse,
    createUserContent,
} from '@google/genai';
import type { AttachmentPart, ChatEvent, CompactionBlock, MessageNode, MemoryPatch } from '../store/types';
import { computePatch, validateEaseMemory } from './memoryEngine';
import { getFinalAnswerText } from './chatEvents';

let geminiClient: GoogleGenAI | null = null;
let activeApiKey: string | null = null;

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
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return parts.reduce<ChatEvent[]>((acc, part) => {
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

function toModelParts(node: MessageNode): Part[] {
    if (node.role !== 'assistant') {
        const parts: Part[] = [{ text: node.content }];
        for (const att of node.attachments ?? []) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
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
                case 'text':
                    return [{ text: event.text }];
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
            }
            }),
        ];
    }

    return [...prefixParts, { text: node.content }];
}

function toGeminiContents(chatPath: MessageNode[]): Content[] {
    return chatPath.map((node) => ({
        role: node.role === 'assistant' ? 'model' : 'user',
        parts: toModelParts(node),
    }));
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
    for (const attachment of pendingAttachments ?? []) {
        parts.push({
            inlineData: {
                mimeType: attachment.mimeType,
                data: attachment.data,
            },
        });
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
            contents.push({
                role: node.role === 'assistant' ? 'model' : 'user',
                parts: toModelParts(node),
            });
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
        model: 'gemini-2.5-flash',
        contents: createUserContent([{
            text: `Summarize this conversation segment concisely for context compaction. Preserve all important facts, decisions, attachments, tool calls, tool results, memory updates, and context needed to continue the conversation naturally. Write in past tense. Omit pleasantries, but do not omit technical or factual details that later turns may rely on.\n\n${transcript}`,
        }]),
        config: { thinkingConfig: { includeThoughts: false } },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

export function buildSystemInstruction(memoryState: string): string {
    return `You are MemoTree AI.
You have access to a text_editor tool to save long-term facts in /memories/.
<memory_files>
/memories/facts.json:
${memoryState}
</memory_files>
CRITICAL: EASE Protocol active. No JSON arrays allowed in memory files. Use key-value only.`;
}

function getGenerationConfig(memoryState: string) {
    return {
        systemInstruction: buildSystemInstruction(memoryState),
        tools: [{
            functionDeclarations: [TEXT_EDITOR_TOOL],
        }],
        thinkingConfig: {
            includeThoughts: true,
        },
    };
}

export async function countTokens(
    chatPath: MessageNode[],
    memoryState: string,
    apiKey: string,
    compactions?: Record<string, CompactionBlock>,
    pendingText?: string,
    pendingAttachments?: AttachmentPart[],
): Promise<number> {
    const client = initGemini(apiKey);
    const response = await client.models.countTokens({
        model: 'gemini-2.5-flash',
        contents: [
            ...buildGeminiContentsWithCompaction(chatPath, compactions ?? {}),
            ...buildPendingDraftContent(pendingText, pendingAttachments),
        ],
        config: {
            systemInstruction: buildSystemInstruction(memoryState),
            tools: [{ functionDeclarations: [TEXT_EDITOR_TOOL] }],
        },
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
) {
    const client = initGemini(apiKey);

    const stream = await client.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents,
        config: getGenerationConfig(memoryState),
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
) {
    return generateGeminiResponseStreamFromContents(
        buildGeminiContentsWithCompaction(chatPath, compactions ?? {}),
        memoryState,
        apiKey,
        signal,
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
                case 'text':
                    return [{ text: event.text }];
                case 'tool_call':
                case 'tool_result':
                    return [];
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
