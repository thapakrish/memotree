import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from './types';
import { useGraphStore } from './useGraphStore';

function resetGraphStore() {
    useGraphStore.setState({
        nodes: {},
        artifacts: {},
        groups: {},
        uiPositions: {},
        canvasPrunedNodeIds: [],
        compactions: {},
        rootId: null,
        activeNodeId: null,
        sessionTitle: undefined,
        importEnvelope: undefined,
        previewNodes: null,
        previewImportEnvelope: null,
        lastImportApplySnapshot: null,
        isHydrated: false,
        isSaving: false,
        lastSavedAt: null,
        saveError: null,
        selectedNodeIds: [],
        canvasSelectedArtifactIds: [],
    });
}

describe('useGraphStore image artifacts', () => {
    beforeEach(() => {
        resetGraphStore();
    });

    it('turns generated image events into disk-backed file artifact records', () => {
        const events: ChatEvent[] = [{
            kind: 'image_artifact',
            artifact: {
                id: 'generated-event-1',
                mimeType: 'image/png',
                data: 'base64-image-data',
                model: 'imagen-4.0-generate-001',
                label: 'Sunrise variant',
            },
        }];

        const nodeId = useGraphStore.getState().addNode({
            parentId: null,
            role: 'assistant',
            responseMode: 'image',
            content: 'Generated image',
            events,
            memoryPatches: [],
            summary: 'Generated image',
        });

        const state = useGraphStore.getState();
        const artifact = state.artifacts['generated-event-1'];
        expect(artifact).toMatchObject({
            id: 'generated-event-1',
            kind: 'image',
            path: '/artifacts/images/generated-event-1/sunrise-variant.png',
            url: '/api/artifacts/images/generated-event-1/sunrise-variant.png',
            mimeType: 'image/png',
            data: 'base64-image-data',
            origin: 'generated',
            sourceNodeId: nodeId,
            sourceEventId: 'generated-event-1',
            model: 'imagen-4.0-generate-001',
            label: 'Sunrise variant',
        });

        const storedEvent = state.nodes[nodeId].events?.[0];
        expect(storedEvent?.kind).toBe('image_artifact');
        if (storedEvent?.kind !== 'image_artifact') {
            throw new Error('Expected generated image event');
        }
        expect(storedEvent.artifact).toMatchObject({
            artifactId: 'generated-event-1',
            artifactPath: '/artifacts/images/generated-event-1/sunrise-variant.png',
            url: '/api/artifacts/images/generated-event-1/sunrise-variant.png',
            data: 'base64-image-data',
        });
    });

    it('clears inline generated image bytes after filesystem storage succeeds', () => {
        const nodeId = useGraphStore.getState().addNode({
            parentId: null,
            role: 'assistant',
            responseMode: 'image',
            content: 'Generated image',
            events: [{
                kind: 'image_artifact',
                artifact: {
                    id: 'generated-event-1',
                    mimeType: 'image/png',
                    data: 'base64-image-data',
                    label: 'Generated image',
                },
            }],
            memoryPatches: [],
        });

        useGraphStore.getState().markImageArtifactsStored([{
            artifactId: 'generated-event-1',
            path: '/artifacts/images/generated-event-1/generated-image.png',
            url: '/api/artifacts/images/generated-event-1/generated-image.png',
            sizeBytes: 15,
        }]);

        const state = useGraphStore.getState();
        expect(state.artifacts['generated-event-1'].data).toBeUndefined();
        expect(state.artifacts['generated-event-1']).toMatchObject({
            path: '/artifacts/images/generated-event-1/generated-image.png',
            url: '/api/artifacts/images/generated-event-1/generated-image.png',
            sizeBytes: 15,
        });

        const storedEvent = state.nodes[nodeId].events?.[0];
        expect(storedEvent?.kind).toBe('image_artifact');
        if (storedEvent?.kind !== 'image_artifact') {
            throw new Error('Expected generated image event');
        }
        expect(storedEvent.artifact.data).toBeUndefined();
        expect(storedEvent.artifact).toMatchObject({
            artifactId: 'generated-event-1',
            artifactPath: '/artifacts/images/generated-event-1/generated-image.png',
            url: '/api/artifacts/images/generated-event-1/generated-image.png',
        });
    });
});
