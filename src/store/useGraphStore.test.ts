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
        canvasSelectedArtifactUse: 'edit_target',
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

    it('keeps canvas image selection role for source and reference workflows', () => {
        useGraphStore.getState().setCanvasArtifactSelection(['image-1'], 'context');

        expect(useGraphStore.getState().canvasSelectedArtifactIds).toEqual(['image-1']);
        expect(useGraphStore.getState().canvasSelectedArtifactUse).toBe('context');

        useGraphStore.getState().clearCanvasArtifactSelection();

        expect(useGraphStore.getState().canvasSelectedArtifactIds).toEqual([]);
        expect(useGraphStore.getState().canvasSelectedArtifactUse).toBe('edit_target');
    });

    it('stores image workflow lineage on generated artifacts', () => {
        const userNodeId = useGraphStore.getState().addNode({
            parentId: null,
            role: 'user',
            sessionIntent: 'style_fit',
            responseMode: 'image',
            content: 'Apply the style.',
            attachments: [{
                id: 'source-attachment',
                kind: 'image',
                mimeType: 'image/png',
                data: 'source-image-data',
                artifactId: 'source-image',
                sourceType: 'file',
                use: 'edit_target',
            }],
            imageWorkflow: {
                intent: 'style_fit',
                prompt: 'Apply the style.',
                sourceArtifactIds: ['source-image'],
                stylePresetId: 'editorial-bw',
                styleLabel: 'Editorial B&W',
            },
            memoryPatches: [],
        });

        useGraphStore.getState().addNode({
            parentId: userNodeId,
            role: 'assistant',
            sessionIntent: 'style_fit',
            responseMode: 'image',
            content: 'Generated styled image',
            events: [{
                kind: 'image_artifact',
                artifact: {
                    id: 'styled-output',
                    mimeType: 'image/png',
                    data: 'styled-output-data',
                    label: 'Styled output',
                },
            }],
            memoryPatches: [],
        });

        expect(useGraphStore.getState().artifacts['styled-output']).toMatchObject({
            id: 'styled-output',
            origin: 'generated',
            parentArtifactIds: ['source-image'],
            workflow: {
                intent: 'style_fit',
                prompt: 'Apply the style.',
                sourceArtifactIds: ['source-image'],
                stylePresetId: 'editorial-bw',
                styleLabel: 'Editorial B&W',
            },
        });
    });
});
