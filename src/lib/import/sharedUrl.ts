import type { ImportSourcePlatform } from '../../store/types';
import {
    SHARED_IMPORT_ENDPOINT,
    type SharedUrlImportRequest,
    type SharedUrlImportResponse,
    type SharedUrlImportErrorResponse,
} from './sharedImportApi';

export interface SharedUrlDetection {
    platform: ImportSourcePlatform;
    normalizedUrl: string;
    isSupported: boolean;
    label: string;
}

export function detectSharedImportUrl(rawUrl: string): SharedUrlDetection | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (host === 'chatgpt.com' && pathname.startsWith('/share/')) {
        return {
            platform: 'chatgpt',
            normalizedUrl: parsed.toString(),
            isSupported: true,
            label: 'ChatGPT shared link',
        };
    }

    if ((host === 'g.co' && pathname.startsWith('/gemini/share/')) || (host === 'gemini.google.com' && pathname.includes('/share/'))) {
        return {
            platform: 'gemini',
            normalizedUrl: parsed.toString(),
            isSupported: true,
            label: 'Gemini shared link',
        };
    }

    if ((host === 'claude.ai' || host === 'claude.site') && pathname.includes('/share/')) {
        return {
            platform: 'claude',
            normalizedUrl: parsed.toString(),
            isSupported: true,
            label: 'Claude shared link',
        };
    }

    return {
        platform: 'other',
        normalizedUrl: parsed.toString(),
        isSupported: false,
        label: 'Unknown shared link',
    };
}

export async function fetchSharedTranscriptFromUrl(url: string): Promise<SharedUrlImportResponse> {
    const response = await fetch(SHARED_IMPORT_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            url,
        } satisfies SharedUrlImportRequest),
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Shared URL import needs a server-side fetch adapter at ${SHARED_IMPORT_ENDPOINT}.`);
        }

        let message = 'Unable to fetch the shared chat transcript.';
        try {
            const errorPayload = await response.json() as SharedUrlImportErrorResponse;
            if (errorPayload.error) {
                message = errorPayload.error;
            }
        } catch {
            // Keep the default message when the response body is not JSON.
        }

        throw new Error(message);
    }

    return await response.json() as SharedUrlImportResponse;
}
