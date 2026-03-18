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
