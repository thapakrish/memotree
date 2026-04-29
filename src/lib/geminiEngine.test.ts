import { describe, expect, it } from 'vitest';
import type { ChatEvent, MessageNode } from '../store/types';
import { buildGeminiContents, interceptMemoryTool } from './geminiEngine';

function node(overrides: Partial<MessageNode>): MessageNode {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        parentId: overrides.parentId ?? null,
        role: overrides.role ?? 'user',
        content: overrides.content ?? '',
        memoryPatches: overrides.memoryPatches ?? [],
        timestamp: overrides.timestamp ?? new Date(0).toISOString(),
        ...overrides,
    };
}

describe('interceptMemoryTool', () => {
    it('rejects str_replace when the target text is not present', () => {
        const result = interceptMemoryTool(
            {
                command: 'str_replace',
                path: '/memories/facts.json',
                old_str: '"missing": true',
                new_str: '"missing": false',
            },
            '{"name":"MemoTree"}',
        );

        expect(result.updatedMemory).toBe('{"name":"MemoTree"}');
        expect(result.patch.diffText).toBe('');
        expect(result.validationError).toMatch(/did not match/);
    });

    it('applies valid key-value memory replacements', () => {
        const result = interceptMemoryTool(
            {
                command: 'str_replace',
                path: '/memories/facts.json',
                old_str: '"name":"MemoTree"',
                new_str: '"name":"MemoTree","status":"active"',
            },
            '{"name":"MemoTree"}',
        );

        expect(result.validationError).toBeUndefined();
        expect(result.updatedMemory).toBe('{"name":"MemoTree","status":"active"}');
        expect(result.patch.diffText).not.toBe('');
    });

    it('rejects array-shaped memory updates', () => {
        const result = interceptMemoryTool(
            {
                command: 'create',
                path: '/memories/facts.json',
                file_text: '{"items":["a","b"]}',
            },
            '{}',
        );

        expect(result.updatedMemory).toBe('{}');
        expect(result.patch.diffText).toBe('');
        expect(result.validationError).toMatch(/arrays/);
    });
});

describe('buildGeminiContents', () => {
    it('serializes assistant tool calls with matching function responses before final text', () => {
        const events: ChatEvent[] = [
            {
                kind: 'tool_call',
                toolName: 'text_editor',
                callId: 'call-1',
                args: {
                    command: 'create',
                    path: '/memories/facts.json',
                    file_text: '{"name":"MemoTree"}',
                },
            },
            {
                kind: 'tool_result',
                toolName: 'text_editor',
                callId: 'call-1',
                status: 'success',
                summary: 'Updated /memories/facts.json',
                payload: {
                    path: '/memories/facts.json',
                    fileText: '{"name":"MemoTree"}',
                },
            },
            {
                kind: 'text',
                text: 'Remembered.',
            },
        ];

        const contents = buildGeminiContents([
            node({ id: 'u1', role: 'user', content: 'Remember the project name.' }),
            node({ id: 'a1', parentId: 'u1', role: 'assistant', events }),
        ]);

        expect(contents.map((content) => content.role)).toEqual(['user', 'model', 'user', 'model']);
        expect(contents[1].parts?.[0]).toMatchObject({
            functionCall: {
                id: 'call-1',
                name: 'text_editor',
            },
        });
        expect(contents[2].parts?.[0]).toMatchObject({
            functionResponse: {
                id: 'call-1',
                name: 'text_editor',
            },
        });
        expect(contents[3].parts?.[0]).toMatchObject({ text: 'Remembered.' });
    });

    it('keeps hydrated generated image artifacts in assistant history', () => {
        const contents = buildGeminiContents([
            node({
                id: 'a1',
                role: 'assistant',
                events: [{
                    kind: 'image_artifact',
                    artifact: {
                        id: 'image-1',
                        artifactId: 'image-1',
                        mimeType: 'image/png',
                        data: 'base64-image',
                    },
                }],
            }),
        ]);

        expect(contents).toHaveLength(1);
        expect(contents[0].parts?.[0]).toMatchObject({
            inlineData: {
                mimeType: 'image/png',
                data: 'base64-image',
            },
        });
    });
});
