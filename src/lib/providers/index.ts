export type { IProvider, ProviderCapabilities, ProviderContextEstimate, ProviderFunctionCall, ProviderFunctionResponse, ProviderRequestConfig, StreamDelta } from './types';

import type { IProvider, ProviderCapabilities, ProviderRequestConfig } from './types';
import type { AttachmentPart } from '../../store/types';

export type ProviderId = 'gemini';

const GEMINI_CAPABILITIES: ProviderCapabilities = {
    supportsImages: true,
    supportsImageOutput: true,
    supportsFileAttachments: true,
    supportsCaching: true,
    supportsThinking: true,
    maxContextTokens: 1_000_000,
};

const providerPromises = new Map<string, Promise<IProvider>>();

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

function estimateSystemInstructionTokens(memoryState: string, requestConfig?: ProviderRequestConfig): number {
    const imageModeGuidanceTokens = requestConfig?.responseMode === 'image' || requestConfig?.responseMode === 'multimodal'
        ? 120
        : 0;
    return roughTokens(memoryState) + 450 + imageModeGuidanceTokens;
}

function loadGeminiProvider(apiKey: string): Promise<IProvider> {
    const existing = providerPromises.get(apiKey);
    if (existing) {
        return existing;
    }

    const providerPromise = import('./gemini').then((module) => module.createGeminiProvider(apiKey));
    providerPromises.set(apiKey, providerPromise);
    return providerPromise;
}

function createLazyGeminiProvider(apiKey: string): IProvider {
    return {
        id: 'gemini',
        capabilities: GEMINI_CAPABILITIES,

        async *stream(path, memoryState, compactions, signal, requestConfig) {
            const provider = await loadGeminiProvider(apiKey);
            yield* provider.stream(path, memoryState, compactions, signal, requestConfig);
        },

        async *continueWithToolResults(path, compactions, priorEvents, priorFunctionCalls, functionResponses, memoryState, signal, requestConfig) {
            const provider = await loadGeminiProvider(apiKey);
            yield* provider.continueWithToolResults(
                path,
                compactions,
                priorEvents,
                priorFunctionCalls,
                functionResponses,
                memoryState,
                signal,
                requestConfig,
            );
        },

        async countTokens(path, memoryState, compactions, pendingText, pendingAttachments, requestConfig) {
            const provider = await loadGeminiProvider(apiKey);
            return provider.countTokens(path, memoryState, compactions, pendingText, pendingAttachments, requestConfig);
        },

        async compactNodes(nodes) {
            const provider = await loadGeminiProvider(apiKey);
            return provider.compactNodes(nodes);
        },

        estimateContext(memoryState, pendingAttachments, requestConfig) {
            return {
                cacheableTokens: estimateSystemInstructionTokens(memoryState, requestConfig),
                attachmentTokens: estimateGeminiAttachmentTokens(pendingAttachments),
            };
        },
    };
}

export function createProvider(id: ProviderId, apiKey: string): IProvider {
    switch (id) {
        case 'gemini':
            return createLazyGeminiProvider(apiKey);
    }
}
