export type { IProvider, ProviderCapabilities, ProviderContextEstimate, ProviderFunctionCall, ProviderFunctionResponse, StreamDelta } from './types';
export type { OllamaModelCapabilities } from './ollama';
export { createGeminiProvider } from './gemini';
export { createOllamaProvider, getOllamaModelCapabilities, listOllamaModels } from './ollama';

import type { IProvider } from './types';
import { createGeminiProvider } from './gemini';
import { createOllamaProvider } from './ollama';

export type ProviderId = 'gemini' | 'ollama';

export interface ProviderConfig {
    apiKey?: string | null;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    ollamaSupportsImages?: boolean;
}

export function createProvider(id: ProviderId, config: ProviderConfig): IProvider | null {
    switch (id) {
        case 'gemini':
            return config.apiKey ? createGeminiProvider(config.apiKey) : null;
        case 'ollama':
            return config.ollamaBaseUrl && config.ollamaModel
                ? createOllamaProvider({
                    baseUrl: config.ollamaBaseUrl,
                    model: config.ollamaModel,
                    supportsImages: config.ollamaSupportsImages,
                })
                : null;
    }
}
