export type { IProvider, ProviderCapabilities, ProviderContextEstimate, ProviderFunctionCall, ProviderFunctionResponse, ProviderRequestConfig, StreamDelta } from './types';
export { createGeminiProvider } from './gemini';

import type { IProvider } from './types';
import { createGeminiProvider } from './gemini';

export type ProviderId = 'gemini';

export function createProvider(id: ProviderId, apiKey: string): IProvider {
    switch (id) {
        case 'gemini':
            return createGeminiProvider(apiKey);
    }
}
