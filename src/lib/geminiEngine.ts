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
import type { ChatEvent, MessageNode, MemoryPatch } from '../store/types';
import { computePatch } from './memoryEngine';
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
): { updatedMemory: string; patch: MemoryPatch } {
    let newText = currentMemoryState;

    if (toolArgs.command === 'create') {
        newText = toolArgs.file_text || '{}';
    } else if (toolArgs.command === 'str_replace') {
        newText = currentMemoryState.replace(toolArgs.old_str, toolArgs.new_str);
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
        return [{ text: node.content }];
    }

    if (node.events && node.events.length > 0) {
        return node.events.flatMap<Part>((event) => {
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
        });
    }

    return [{ text: node.content }];
}

function toGeminiContents(chatPath: MessageNode[]): Content[] {
    return chatPath.map((node) => ({
        role: node.role === 'assistant' ? 'model' : 'user',
        parts: toModelParts(node),
    }));
}

function getGenerationConfig(memoryState: string) {
    return {
        systemInstruction: `You are MemoTree AI.
You have access to a text_editor tool to save long-term facts in /memories/.
<memory_files>
/memories/facts.json:
${memoryState}
</memory_files>
CRITICAL: EASE Protocol active. No JSON arrays allowed in memory files. Use key-value only.`,
        tools: [{
            functionDeclarations: [TEXT_EDITOR_TOOL],
        }],
        thinkingConfig: {
            includeThoughts: true,
        },
    };
}

export async function generateGeminiResponseStreamFromContents(
    contents: Content[],
    memoryState: string,
    apiKey: string,
) {
    const client = initGemini(apiKey);

    return client.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents,
        config: getGenerationConfig(memoryState),
    });
}

export async function generateGeminiResponseStream(
    chatPath: MessageNode[],
    memoryState: string,
    apiKey: string,
) {
    return generateGeminiResponseStreamFromContents(
        toGeminiContents(chatPath),
        memoryState,
        apiKey,
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
