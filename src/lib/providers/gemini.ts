import type { IProvider, ProviderCapabilities, ProviderContextEstimate, ProviderFunctionCall, StreamDelta } from './types';
import type { AttachmentPart, ChatEvent } from '../../store/types';
import {
    buildGeminiContentsWithCompaction,
    buildSystemInstruction,
    compactPathNodes,
    countTokens as geminiCountTokens,
    createFunctionResponseContent,
    createModelToolCallContent,
    extractAssistantEvents,
    extractFunctionCalls,
    extractThoughtsTokenCount,
    generateImagenEvents,
    generateGeminiResponseStream,
    generateGeminiResponseStreamFromContents,
} from '../geminiEngine';
import { mergeEvents } from '../chatEvents';
import type { GenerateContentResponse } from '@google/genai';
import { isImagenModelId } from '../geminiModels';

async function* normalizeStream(
    rawStream: AsyncGenerator<GenerateContentResponse>,
): AsyncGenerator<StreamDelta> {
    let events: ChatEvent[] = [];
    let maxThoughtsTokenCount = 0;
    const functionCallsMap = new Map<string, ProviderFunctionCall>();

    for await (const chunk of rawStream) {
        const chunkEvents = extractAssistantEvents(chunk);
        if (chunkEvents.length > 0) {
            events = mergeEvents(events, chunkEvents);
        }

        const tc = extractThoughtsTokenCount(chunk);
        if (tc > maxThoughtsTokenCount) maxThoughtsTokenCount = tc;

        for (const call of extractFunctionCalls(chunk)) {
            const key = JSON.stringify([call.id ?? '', call.name ?? '', call.args ?? {}]);
            functionCallsMap.set(key, {
                id: call.id,
                name: call.name ?? '',
                args: (call.args ?? {}) as Record<string, unknown>,
            });
        }

        yield {
            events,
            thoughtsTokenCount: maxThoughtsTokenCount,
            functionCalls: [...functionCallsMap.values()],
        };
    }
}

const GEMINI_CAPABILITIES: ProviderCapabilities = {
    supportsImages: true,
    supportsImageOutput: true,
    supportsFileAttachments: true,
    supportsCaching: true,
    supportsThinking: true,
    maxContextTokens: 1_000_000,
};

function roughTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function estimateGeminiAttachmentTokens(attachments: AttachmentPart[] = []): number {
    return attachments.reduce((sum, attachment) => {
        const rawBytes = attachment.data
            ? attachment.data.length * 0.75
            : attachment.sizeBytes ?? 0;
        if (rawBytes === 0) {
            return sum;
        }
        const estimatedTiles = Math.ceil(rawBytes / (768 * 768 * 3));
        return sum + Math.max(258, estimatedTiles * 258);
    }, 0);
}

function canUseImagenGeneration(path: Array<{ content: string; attachments?: AttachmentPart[] }>, requestConfig?: { responseMode?: string; imageModelId?: string }): boolean {
    const lastNode = path.at(-1);
    const hasImageInput = (lastNode?.attachments ?? []).some((attachment) => attachment.kind === 'image');
    return requestConfig?.responseMode === 'image'
        && isImagenModelId(requestConfig.imageModelId)
        && Boolean(lastNode?.content.trim())
        && !hasImageInput;
}

export function createGeminiProvider(apiKey: string): IProvider {
    return {
        id: 'gemini',
        capabilities: GEMINI_CAPABILITIES,

        async *stream(path, memoryState, compactions, signal, requestConfig) {
            if (canUseImagenGeneration(path, requestConfig)) {
                const events = await generateImagenEvents(path.at(-1)?.content ?? '', apiKey, signal, requestConfig);
                yield {
                    events,
                    thoughtsTokenCount: 0,
                    functionCalls: [],
                };
                return;
            }

            const rawStream = await generateGeminiResponseStream(
                path, memoryState, apiKey, signal, compactions, requestConfig,
            );
            yield* normalizeStream(rawStream);
        },

        async *continueWithToolResults(path, compactions, priorEvents, priorFunctionCalls, functionResponses, memoryState, signal, requestConfig) {
            const baseContents = buildGeminiContentsWithCompaction(path, compactions);
            const followUpContents = [
                ...baseContents,
                createModelToolCallContent(priorEvents, priorFunctionCalls),
                createFunctionResponseContent(functionResponses),
            ];
            const rawStream = await generateGeminiResponseStreamFromContents(
                followUpContents, memoryState, apiKey, signal, requestConfig,
            );
            yield* normalizeStream(rawStream);
        },

        async countTokens(path, memoryState, compactions, pendingText, pendingAttachments, requestConfig) {
            return geminiCountTokens(path, memoryState, apiKey, compactions, pendingText, pendingAttachments, requestConfig);
        },

        async compactNodes(nodes) {
            return compactPathNodes(nodes, apiKey);
        },

        estimateContext(memoryState, pendingAttachments, requestConfig): ProviderContextEstimate {
            return {
                cacheableTokens: roughTokens(buildSystemInstruction(memoryState, requestConfig)),
                attachmentTokens: estimateGeminiAttachmentTokens(pendingAttachments),
            };
        },
    };
}
