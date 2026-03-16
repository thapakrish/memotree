import type { ImportSourcePlatform, ImportedTurn, InferenceConfidence } from '../../store/types';

export const SHARED_IMPORT_ENDPOINT = '/api/import/fetch-shared';

export interface SharedUrlImportRequest {
    url: string;
}

export interface SharedUrlImportResponse {
    sourcePlatform: ImportSourcePlatform;
    sourceConversationId?: string;
    turns: ImportedTurn[];
    parserConfidence: InferenceConfidence;
    parserName: string;
    warnings?: string[];
}

export interface SharedUrlImportErrorResponse {
    error: string;
}

export const SHARED_IMPORT_ENDPOINT_NOTES = [
    'POST /api/import/fetch-shared',
    'Request body: { url: string }',
    'Response body: { sourcePlatform, sourceConversationId?, turns, parserConfidence, parserName, warnings? }',
    'The server should fetch a public shared-chat snapshot and normalize it into ImportedTurn[].',
    'The client should never scrape third-party share pages directly.',
] as const;
