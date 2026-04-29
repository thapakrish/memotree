import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageFileArtifact } from '../store/types';
import { saveImageArtifactFile } from './artifactStorage';

function generatedImageArtifact(overrides: Partial<ImageFileArtifact> = {}): ImageFileArtifact {
    return {
        id: overrides.id ?? 'image-1',
        kind: 'image',
        path: overrides.path ?? '/artifacts/images/image-1/generated-image.png',
        url: overrides.url ?? '/api/artifacts/images/image-1/generated-image.png',
        mimeType: overrides.mimeType ?? 'image/png',
        data: overrides.data ?? 'base64-image-data',
        name: overrides.name ?? 'generated-image.png',
        sizeBytes: overrides.sizeBytes,
        origin: overrides.origin ?? 'generated',
        createdAt: overrides.createdAt ?? new Date(0).toISOString(),
        sourceNodeId: overrides.sourceNodeId,
        sourceEventId: overrides.sourceEventId,
        sourceAttachmentId: overrides.sourceAttachmentId,
        parentArtifactIds: overrides.parentArtifactIds,
        model: overrides.model,
        label: overrides.label,
    };
}

describe('artifactStorage', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts generated image artifacts to the filesystem artifact endpoint', async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
            artifactId: 'image-1',
            path: '/artifacts/images/image-1/generated-image.png',
            url: '/api/artifacts/images/image-1/generated-image.png',
            mimeType: 'image/png',
            sizeBytes: 15,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await saveImageArtifactFile('session-1', generatedImageArtifact());

        expect(fetchMock).toHaveBeenCalledWith('/api/artifacts/images', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const requestInit = fetchMock.mock.calls[0]?.[1];
        if (!requestInit || typeof requestInit.body !== 'string') {
            throw new Error('Expected filesystem artifact request to include a JSON body');
        }
        expect(JSON.parse(requestInit.body)).toEqual({
            sessionId: 'session-1',
            artifactId: 'image-1',
            fileName: 'generated-image.png',
            mimeType: 'image/png',
            data: 'base64-image-data',
        });
        expect(result).toEqual({
            artifactId: 'image-1',
            path: '/artifacts/images/image-1/generated-image.png',
            url: '/api/artifacts/images/image-1/generated-image.png',
            sizeBytes: 15,
        });
    });
});
