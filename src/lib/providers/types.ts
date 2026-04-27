import type { AttachmentPart, AssistantResponseMode, ChatEvent, CompactionBlock, MessageNode } from '../../store/types';

export interface ProviderCapabilities {
    supportsImages: boolean;
    supportsImageOutput: boolean;
    supportsFileAttachments: boolean;
    supportsCaching: boolean;
    supportsThinking: boolean;
    maxContextTokens: number;
}

export interface ProviderContextEstimate {
    cacheableTokens: number;
    attachmentTokens: number;
}

export interface ProviderFunctionCall {
    id?: string;
    name: string;
    args: Record<string, unknown>;
}

export interface ProviderFunctionResponse {
    id?: string;
    name: string;
    response: Record<string, unknown>;
}

export interface ProviderRequestConfig {
    responseMode?: AssistantResponseMode;
    imageModelId?: string;
    imageOutputCount?: number;
    textModelId?: string;
}

/**
 * Yielded by stream generators. Each delta contains the cumulative event list
 * and running thoughts token count. Function calls are populated as soon as
 * they are parsed from the stream.
 */
export interface StreamDelta {
    events: ChatEvent[];
    thoughtsTokenCount: number;
    /** Deduplicated function calls seen so far in this stream. */
    functionCalls: ProviderFunctionCall[];
}

export interface IProvider {
    readonly id: string;
    readonly capabilities: ProviderCapabilities;

    /** Stream a response for the given path. Yields cumulative StreamDeltas. */
    stream(
        path: MessageNode[],
        memoryState: string,
        compactions: Record<string, CompactionBlock>,
        signal?: AbortSignal,
        requestConfig?: ProviderRequestConfig,
    ): AsyncGenerator<StreamDelta>;

    /**
     * Continue a turn after tool results have been collected.
     * Builds the follow-up request (path context + model tool-call message +
     * function responses) and streams the next model response.
     */
    continueWithToolResults(
        path: MessageNode[],
        compactions: Record<string, CompactionBlock>,
        priorEvents: ChatEvent[],
        priorFunctionCalls: ProviderFunctionCall[],
        functionResponses: ProviderFunctionResponse[],
        memoryState: string,
        signal?: AbortSignal,
        requestConfig?: ProviderRequestConfig,
    ): AsyncGenerator<StreamDelta>;

    countTokens(
        path: MessageNode[],
        memoryState: string,
        compactions: Record<string, CompactionBlock>,
        pendingText?: string,
        pendingAttachments?: AttachmentPart[],
        requestConfig?: ProviderRequestConfig,
    ): Promise<number>;

    compactNodes(nodes: MessageNode[]): Promise<string>;
    estimateContext(memoryState: string, pendingAttachments?: AttachmentPart[], requestConfig?: ProviderRequestConfig): ProviderContextEstimate;
}
