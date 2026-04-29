import { describe, expect, it, vi } from 'vitest';
import type { ImageFileArtifact, MessageNode } from '../store/types';
import { hydrateAttachmentImageData, hydrateMessagePathImageData } from './hydrateImageData';

function imageArtifact(overrides: Partial<ImageFileArtifact>): ImageFileArtifact {
    return {
        id: overrides.id ?? 'image-1',
        kind: 'image',
        path: overrides.path ?? '/artifacts/images/image-1/image.png',
        url: overrides.url ?? '/api/artifacts/images/image-1/image.png',
        mimeType: overrides.mimeType ?? 'image/png',
        name: overrides.name ?? 'image.png',
        origin: overrides.origin ?? 'generated',
        createdAt: overrides.createdAt ?? new Date(0).toISOString(),
        ...overrides,
    };
}

function messageNode(overrides: Partial<MessageNode>): MessageNode {
    return {
        id: overrides.id ?? 'node-1',
        parentId: overrides.parentId ?? null,
        role: overrides.role ?? 'assistant',
        content: overrides.content ?? '',
        memoryPatches: overrides.memoryPatches ?? [],
        timestamp: overrides.timestamp ?? new Date(0).toISOString(),
        ...overrides,
    };
}

describe('hydrateImageData', () => {
    it('hydrates image attachments from persisted artifact URLs', async () => {
        const readImageUrlAsBase64 = vi.fn(async () => 'attachment-bytes');
        const attachment = await hydrateAttachmentImageData(
            {
                id: 'attachment-1',
                kind: 'image',
                mimeType: 'image/png',
                artifactId: 'image-1',
                sourceType: 'generated',
            },
            {
                artifacts: {
                    'image-1': imageArtifact({ id: 'image-1', url: '/api/image-1.png' }),
                },
                readImageUrlAsBase64,
            },
        );

        expect(readImageUrlAsBase64).toHaveBeenCalledWith('/api/image-1.png');
        expect(attachment.data).toBe('attachment-bytes');
    });

    it('hydrates assistant image events from persisted artifact URLs', async () => {
        const readImageUrlAsBase64 = vi.fn(async () => 'event-bytes');
        const hydrated = await hydrateMessagePathImageData(
            [
                messageNode({
                    events: [{
                        kind: 'image_artifact',
                        artifact: {
                            id: 'image-1',
                            artifactId: 'image-1',
                            mimeType: 'image/png',
                        },
                    }],
                }),
            ],
            {
                artifacts: {
                    'image-1': imageArtifact({ id: 'image-1', url: '/api/image-1.png' }),
                },
                readImageUrlAsBase64,
            },
        );

        const event = hydrated[0].events?.[0];
        expect(event?.kind).toBe('image_artifact');
        if (event?.kind !== 'image_artifact') {
            throw new Error('Expected image artifact event');
        }
        expect(readImageUrlAsBase64).toHaveBeenCalledWith('/api/image-1.png');
        expect(event.artifact.data).toBe('event-bytes');
        expect(event.artifact.url).toBe('/api/image-1.png');
    });

    it('keeps historical image events when persisted files cannot be read', async () => {
        const hydrated = await hydrateMessagePathImageData(
            [
                messageNode({
                    events: [{
                        kind: 'image_artifact',
                        artifact: {
                            id: 'image-1',
                            artifactId: 'image-1',
                            mimeType: 'image/png',
                        },
                    }],
                }),
            ],
            {
                artifacts: {
                    'image-1': imageArtifact({ id: 'image-1', url: '/api/missing.png' }),
                },
                readImageUrlAsBase64: async () => {
                    throw new Error('missing');
                },
            },
        );

        const event = hydrated[0].events?.[0];
        expect(event?.kind).toBe('image_artifact');
        if (event?.kind !== 'image_artifact') {
            throw new Error('Expected image artifact event');
        }
        expect(event.artifact.data).toBeUndefined();
        expect(event.artifact.url).toBe('/api/missing.png');
    });
});
