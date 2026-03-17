import { startTransition, useEffect, useRef, useState } from 'react';
import { Send, CornerDownRight, Cpu, User, KeyRound, Loader2, BrainCircuit, Wrench, CheckCircle2, CircleAlert, FolderOpen, GitBranch, Undo2, Eye, Copy, Check, Square, Paperclip, X, ImageIcon, ScanText } from 'lucide-react';
import type { Content, FunctionCall, GenerateContentResponse, Part } from '@google/genai';
import { useGraphStore } from '../store/useGraphStore';
import type { AttachmentMimeType, AttachmentPart, ChatEvent, CompactionBlock, MessageNode } from '../store/types';
import {
    compactPathNodes,
    createFunctionResponseContent,
    createModelToolCallContent,
    extractAssistantEvents,
    extractFunctionCalls,
    extractThoughtsTokenCount,
    generateGeminiResponseStream,
    generateGeminiResponseStreamFromContents,
    getAssistantText,
    interceptMemoryTool,
} from '../lib/geminiEngine';
import { appendEvent, getFinalAnswerText, getNodeSummary, mergeEvents } from '../lib/chatEvents';
import { reconstructMemory } from '../lib/memoryEngine';
import { SessionsModal } from './SessionsModal';
import { ImportSuggestionsModal } from './ImportSuggestionsModal';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ContextInspector } from './ContextInspector';

function getTextSummary(text: string): string {
    return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

function normalizeToolArgs(args: unknown): Record<string, string> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return {};
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
            normalized[key] = value;
        }
    }

    return normalized;
}

const SUPPORTED_IMAGE_TYPES: AttachmentMimeType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_DIM = 2048;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function extractBase64Payload(dataUrl: string): string | null {
    const [, payload] = dataUrl.split(',', 2);
    return payload || null;
}

async function processImageFile(
    file: File,
    sourceType: AttachmentPart['sourceType'],
): Promise<AttachmentPart | null> {
    const mimeType = file.type as AttachmentMimeType;
    if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) return null;

    return new Promise((resolve) => {
        const reader = new FileReader();
        const fail = () => resolve(null);

        reader.onerror = fail;
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (!dataUrl) {
                fail();
                return;
            }

            const finalize = (base64: string, finalMime: AttachmentMimeType) => {
                resolve({
                    id: crypto.randomUUID(),
                    kind: 'image',
                    mimeType: finalMime,
                    data: base64,
                    name: file.name || undefined,
                    sizeBytes: file.size,
                    sourceType,
                });
            };

            if (file.size <= MAX_IMAGE_BYTES) {
                const base64 = extractBase64Payload(dataUrl);
                if (!base64) {
                    fail();
                    return;
                }
                finalize(base64, mimeType);
                return;
            }

            if (mimeType === 'image/gif') {
                fail();
                return;
            }

            // Resize large images via canvas
            const img = new Image();
            img.onerror = fail;
            img.onload = () => {
                const scale = Math.min(MAX_IMAGE_DIM / img.width, MAX_IMAGE_DIM / img.height, 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const context = canvas.getContext('2d');
                if (!context) {
                    fail();
                    return;
                }
                context.drawImage(img, 0, 0, canvas.width, canvas.height);

                const resizedDataUrl = mimeType === 'image/png'
                    ? canvas.toDataURL('image/png')
                    : mimeType === 'image/webp'
                        ? canvas.toDataURL('image/webp', 0.85)
                        : canvas.toDataURL('image/jpeg', 0.85);
                const resizedBase64 = extractBase64Payload(resizedDataUrl);
                if (!resizedBase64) {
                    fail();
                    return;
                }
                finalize(
                    resizedBase64,
                    mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg',
                );
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
}

async function processClipboardItems(
    items: DataTransferItemList,
): Promise<AttachmentPart[]> {
    const results: AttachmentPart[] = [];
    for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                const part = await processImageFile(file, 'clipboard');
                if (part) results.push(part);
            }
        }
    }
    return results;
}

function toReplayParts(msg: MessageNode) {
    if (msg.role !== 'assistant') {
        const parts: Part[] = [{ text: msg.content }];
        for (const att of msg.attachments ?? []) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
        }
        return parts;
    }

    return (msg.events ?? []).flatMap<Part>((event) => {
        switch (event.kind) {
            case 'thought':
                return [{
                    text: event.text,
                    thought: true as const,
                    thoughtSignature: event.signature,
                }];
            case 'text':
                return [{ text: event.text }];
            case 'tool_call':
                return [{
                    functionCall: {
                        id: event.callId,
                        name: event.toolName,
                        args: event.args,
                    },
                }];
            case 'tool_result':
                return [];
            }
        });
}

const MAX_TOOL_ROUNDS = 2;

async function collectStreamedAssistantResponse(
    stream: AsyncGenerator<GenerateContentResponse>,
    setStreamingEvents: (events: ChatEvent[]) => void,
    setThoughtsTokenCount: (count: number) => void,
) {
    let events: ChatEvent[] = [];
    let maxThoughtsTokenCount = 0;
    const functionCalls = new Map<string, FunctionCall>();

    for await (const chunk of stream) {
        const chunkEvents = extractAssistantEvents(chunk);
        if (chunkEvents.length > 0) {
            events = mergeEvents(events, chunkEvents);
            startTransition(() => {
                setStreamingEvents(events);
            });
        }

        const chunkThoughtsTokenCount = extractThoughtsTokenCount(chunk);
        if (chunkThoughtsTokenCount > maxThoughtsTokenCount) {
            maxThoughtsTokenCount = chunkThoughtsTokenCount;
            startTransition(() => {
                setThoughtsTokenCount(chunkThoughtsTokenCount);
            });
        }

        for (const call of extractFunctionCalls(chunk)) {
            const functionKey = JSON.stringify([
                call.id ?? '',
                call.name ?? '',
                call.args ?? {},
            ]);
            functionCalls.set(functionKey, call);
        }
    }

    return {
        events,
        thoughtsTokenCount: maxThoughtsTokenCount,
        functionCalls: [...functionCalls.values()],
    };
}

function CopyMessageButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setFailed(true);
            setCopied(false);
            setTimeout(() => setFailed(false), 2000);
        }
    };

    return (
        <button
            onClick={handleCopy}
            title="Copy message"
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-slate-700"
        >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : failed ? 'Failed' : 'Copy'}
        </button>
    );
}

function AssistantMessageBody({
    events,
    fallbackText,
    isStreaming,
}: {
    events?: ChatEvent[];
    fallbackText: string;
    isStreaming?: boolean;
}) {
    const messageEvents = events ?? [];

    if (messageEvents.length === 0) {
        return <MarkdownRenderer text={fallbackText} isStreaming={isStreaming} />;
    }

    const lastTextIndex = messageEvents.reduce((last, event, i) =>
        event.kind === 'text' ? i : last, -1);

    return (
        <div className="space-y-3">
            {messageEvents.map((event, index) => {
                switch (event.kind) {
                    case 'thought':
                        return (
                            <details
                                key={`${event.kind}-${event.signature ?? index}-${index}`}
                                className="group/thought rounded-xl border border-amber-200 bg-amber-50/80"
                            >
                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 marker:content-none">
                                    <BrainCircuit className="h-3.5 w-3.5" />
                                    <span className="flex-1">
                                        Thinking
                                        {event.tokenCount ? ` · ${event.tokenCount.toLocaleString()} tokens` : ''}
                                    </span>
                                    <span className="text-[10px] normal-case tracking-normal text-amber-600 group-open/thought:hidden">Show</span>
                                    <span className="hidden text-[10px] normal-case tracking-normal text-amber-600 group-open/thought:inline">Hide</span>
                                </summary>
                                <div className="border-t border-amber-200 px-3 py-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                                    {event.text}
                                </div>
                            </details>
                        );
                    case 'tool_call':
                        return (
                            <div key={`${event.kind}-${event.callId ?? index}`} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                                <div className="flex items-center gap-2 font-medium">
                                    <Wrench className="h-3.5 w-3.5" />
                                    <span>{event.toolName}</span>
                                </div>
                                <div className="mt-1 text-xs text-sky-700 whitespace-pre-wrap">
                                    {JSON.stringify(event.args, null, 2)}
                                </div>
                            </div>
                        );
                    case 'tool_result':
                        return (
                            <details key={`${event.kind}-${event.callId ?? index}`} className="group/result rounded-xl border border-emerald-200 bg-emerald-50/80">
                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 marker:content-none">
                                    {event.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                                    <span className="flex-1">{event.summary}</span>
                                    <span className="text-[10px] normal-case tracking-normal text-emerald-600 group-open/result:hidden">Show</span>
                                    <span className="hidden text-[10px] normal-case tracking-normal text-emerald-600 group-open/result:inline">Hide</span>
                                </summary>
                                {event.payload !== undefined && (
                                    <pre className="overflow-x-auto border-t border-emerald-200 px-3 py-3 text-xs leading-relaxed text-emerald-900 whitespace-pre-wrap">
                                        {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                )}
                            </details>
                        );
                    case 'text':
                        return (
                            <MarkdownRenderer
                                key={`${event.kind}-${index}`}
                                text={event.text}
                                isStreaming={isStreaming && index === lastTextIndex}
                            />
                        );
                }
            })}
        </div>
    );
}

export function ChatView() {
    const {
        activeNodeId,
        getPath,
        addNode,
        setActiveNode,
        apiKey,
        setApiKey,
        importEnvelope,
        previewImportEnvelope,
        applyAcceptedImportSuggestions,
        clearImportPreview,
        undoLastImportApply,
        lastImportApplySnapshot,
        compactions,
        addCompaction,
        removeCompaction,
    } = useGraphStore();
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [streamingEvents, setStreamingEvents] = useState<ChatEvent[]>([]);
    const [thoughtsTokenCount, setThoughtsTokenCount] = useState(0);
    const [isSessionsOpen, setIsSessionsOpen] = useState(false);
    const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
    const [attachments, setAttachments] = useState<AttachmentPart[]>([]);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);
    const [isCompacting, setIsCompacting] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const addAttachments = (parts: AttachmentPart[]) => {
        setAttachments((prev) => [...prev, ...parts]);
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const hasImage = Array.from(e.clipboardData.items).some(
            (item) => item.kind === 'file' && item.type.startsWith('image/'),
        );
        if (!hasImage) return;

        e.preventDefault();
        const parts = await processClipboardItems(e.clipboardData.items);
        if (parts.length > 0) {
            addAttachments(parts);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (Array.from(e.dataTransfer.items).some((item) => item.type.startsWith('image/'))) {
            e.preventDefault();
            setIsDraggingOver(true);
        }
    };

    const handleDragLeave = () => setIsDraggingOver(false);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
        const parts = await Promise.all(files.map((f) => processImageFile(f, 'drop')));
        addAttachments(parts.filter(Boolean) as AttachmentPart[]);
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        const parts = await Promise.all(files.map((f) => processImageFile(f, 'file')));
        addAttachments(parts.filter(Boolean) as AttachmentPart[]);
        e.target.value = '';
    };

    const path = getPath(activeNodeId);
    const visibleImportEnvelope = previewImportEnvelope ?? importEnvelope;
    const acceptedSuggestionCount = visibleImportEnvelope?.suggestions?.filter((suggestion) => suggestion.status === 'accepted').length ?? 0;
    const pendingSuggestionCount = visibleImportEnvelope?.suggestions?.filter((suggestion) => suggestion.status !== 'accepted' && suggestion.status !== 'rejected').length ?? 0;

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [streamingEvents, isTyping, path.length]);

    // Auto-resize textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [input]);

    const handleStop = () => {
        abortControllerRef.current?.abort();
    };

    // Keep the most recent 6 nodes (3 exchanges); compact everything before that boundary.
    const KEEP_RECENT_NODES = 6;
    const getCompactionRange = (): MessageNode[] | null => {
        if (path.length <= KEEP_RECENT_NODES) return null;
        let cutPoint = path.length - KEEP_RECENT_NODES;
        // Snap backward to the start of a user message so we never split an exchange
        while (cutPoint > 0 && path[cutPoint]?.role !== 'user') cutPoint--;
        if (cutPoint <= 0) return null;
        return path.slice(0, cutPoint);
    };

    const handleCompactPath = async () => {
        if (!apiKey || isCompacting) return;
        const toCompact = getCompactionRange();
        if (!toCompact || toCompact.length === 0) return;
        setIsCompacting(true);
        try {
            const summary = await compactPathNodes(toCompact, apiKey);
            if (summary) {
                const block: CompactionBlock = {
                    id: crypto.randomUUID(),
                    nodeIds: toCompact.map((n) => n.id),
                    summary,
                    tokensBefore: Math.ceil(toCompact.reduce((s, n) => s + n.content.length, 0) / 4),
                    createdAt: new Date().toISOString(),
                };
                addCompaction(block);
            }
        } catch (err) {
            console.error('Compaction failed:', err);
            alert('Compaction failed. Check console.');
        } finally {
            setIsCompacting(false);
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && attachments.length === 0) || !apiKey) return;

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const activeNode = path.length > 0 ? path[path.length - 1] : null;
        const parentId = activeNode?.role === 'user' ? activeNode.parentId : activeNodeId;

        const userNodeId = addNode({
            parentId,
            role: 'user',
            content: input,
            attachments: attachments.length > 0 ? attachments : undefined,
            memoryPatches: [],
            summary: getTextSummary(input),
        });

        setInput('');
        setAttachments([]);
        setIsTyping(true);
        setStreamingEvents([]);
        setThoughtsTokenCount(0);

        try {
            const newPath = getPath(userNodeId);
            const memoryState = reconstructMemory(newPath);
            const initialStream = await generateGeminiResponseStream(newPath, memoryState, apiKey, controller.signal, compactions);
            const initialResponse = await collectStreamedAssistantResponse(
                initialStream,
                setStreamingEvents,
                setThoughtsTokenCount,
            );

            let events = initialResponse.events;
            let nextMemoryState = memoryState;
            const patches = [];
            let pendingFunctionCalls = initialResponse.functionCalls;
            let toolRounds = 0;

            while (pendingFunctionCalls.length > 0 && toolRounds < MAX_TOOL_ROUNDS && !controller.signal.aborted) {
                toolRounds += 1;
                const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];

                for (const call of pendingFunctionCalls) {
                    if (call.name !== 'text_editor') {
                        const toolName = call.name ?? 'unknown_tool';
                        const unsupportedToolEvent: ChatEvent = {
                            kind: 'tool_result',
                            toolName,
                            callId: call.id,
                            status: 'error',
                            summary: `Unsupported tool call: ${toolName}`,
                            payload: call.args,
                        };
                        events = appendEvent(events, unsupportedToolEvent);
                        continue;
                    }

                    const toolArgs = normalizeToolArgs(call.args);
                    const { patch, updatedMemory } = interceptMemoryTool(
                        toolArgs,
                        nextMemoryState,
                    );
                    patches.push(patch);
                    nextMemoryState = updatedMemory;

                    const toolResultEvent: ChatEvent = {
                        kind: 'tool_result',
                        toolName: call.name,
                        callId: call.id,
                        status: 'success',
                        summary: `Updated ${toolArgs.path ?? '/memories/facts.json'}`,
                        payload: {
                            path: toolArgs.path ?? '/memories/facts.json',
                            fileText: updatedMemory,
                        },
                    };

                    events = appendEvent(events, toolResultEvent);
                    functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                            output: toolResultEvent.summary,
                            fileText: updatedMemory,
                        },
                    });
                }

                setStreamingEvents(events);

                if (functionResponses.length === 0) {
                    break;
                }

                const followUpContents: Content[] = [
                    ...newPath.map((node) => ({
                        role: node.role === 'assistant' ? 'model' : 'user',
                        parts: toReplayParts(node),
                    })),
                    createModelToolCallContent(events, pendingFunctionCalls),
                    createFunctionResponseContent(functionResponses),
                ];

                const followUpStream = await generateGeminiResponseStreamFromContents(
                    followUpContents,
                    nextMemoryState,
                    apiKey,
                    controller.signal,
                );
                const followUpResponse = await collectStreamedAssistantResponse(
                    followUpStream,
                    setStreamingEvents,
                    setThoughtsTokenCount,
                );

                events = mergeEvents(events, followUpResponse.events);
                pendingFunctionCalls = followUpResponse.functionCalls;
            }

            if (pendingFunctionCalls.length > 0 && !controller.signal.aborted) {
                events = appendEvent(events, {
                    kind: 'tool_result',
                    toolName: 'tool_loop_guard',
                    status: 'error',
                    summary: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds`,
                    payload: {
                        remainingCalls: pendingFunctionCalls.map((call) => ({
                            id: call.id,
                            name: call.name,
                        })),
                    },
                });
            }

            // Only save node if we got something (even if aborted mid-stream)
            if (events.length > 0) {
                const assistantText = getAssistantText(events) || 'Tool ran with no user-facing answer';
                addNode({
                    parentId: userNodeId,
                    role: 'assistant',
                    content: assistantText,
                    events,
                    memoryPatches: patches,
                    summary: getNodeSummary({ role: 'assistant', events, content: assistantText }),
                });
            }
        } catch (err) {
            console.error(err);
            alert('API request failed. Check API Key or console.');
        } finally {
            setIsTyping(false);
            setStreamingEvents([]);
            setThoughtsTokenCount(0);
            abortControllerRef.current = null;
        }
    };

    const streamingDisplayEvents = streamingEvents.length > 0
        ? streamingEvents.map((event) => (
            event.kind === 'thought' && !event.tokenCount && thoughtsTokenCount
                ? { ...event, tokenCount: thoughtsTokenCount }
                : event
        ))
        : [];

    return (
        <div className="w-full h-full flex flex-col bg-white border-r border-slate-200 shadow-sm z-20">
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 bg-white shadow-sm shrink-0">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-800">MemoTree</h1>
                    <p className="text-xs font-medium text-slate-400">Time-Traveling LLM Interface</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsInspectorOpen((v) => !v)}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                            isInspectorOpen
                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                        title="Toggle context inspector"
                    >
                        <ScanText className="h-3.5 w-3.5" />
                        <span>Context</span>
                    </button>
                    <button
                        onClick={() => setIsSessionsOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>Sessions</span>
                    </button>
                </div>
            </div>
            {isInspectorOpen && (
                <ContextInspector
                    path={path}
                    pendingInput={input}
                    pendingAttachments={attachments}
                    apiKey={apiKey}
                    importEnvelope={visibleImportEnvelope ?? undefined}
                    compactions={compactions}
                    isCompacting={isCompacting}
                    canCompact={getCompactionRange() !== null}
                    onCompactPath={handleCompactPath}
                    onRemoveCompaction={removeCompaction}
                />
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scroll-smooth">
                {visibleImportEnvelope && (
                    <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                        <div className="font-semibold">
                            Imported from {visibleImportEnvelope.sourcePlatform.charAt(0).toUpperCase() + visibleImportEnvelope.sourcePlatform.slice(1)}
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-violet-700">
                            {visibleImportEnvelope.messageCount} turns imported. {visibleImportEnvelope.suggestions?.length ?? 0} deterministic structure suggestions detected.
                        </div>
                        {visibleImportEnvelope.parserConfidence && (
                            <div className="mt-1 text-xs leading-relaxed text-violet-700">
                                Parser confidence: {visibleImportEnvelope.parserConfidence}
                                {visibleImportEnvelope.sourceConversationId ? ` · source ${visibleImportEnvelope.sourceConversationId.slice(0, 8)}` : ''}
                            </div>
                        )}
                        <div className="mt-3 flex items-center gap-3">
                            <button
                                onClick={() => setIsSuggestionsOpen(true)}
                                className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100"
                            >
                                <GitBranch className="h-3.5 w-3.5" />
                                <span>Review Suggestions</span>
                            </button>
                            {previewImportEnvelope ? (
                                <>
                                    <button
                                        onClick={() => applyAcceptedImportSuggestions()}
                                        disabled={acceptedSuggestionCount === 0}
                                        className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <GitBranch className="h-3.5 w-3.5" />
                                        <span>Apply Preview</span>
                                    </button>
                                    <button
                                        onClick={() => clearImportPreview()}
                                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100"
                                    >
                                        <Eye className="h-3.5 w-3.5" />
                                        <span>Exit Preview</span>
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => applyAcceptedImportSuggestions()}
                                    disabled={acceptedSuggestionCount === 0}
                                    className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <GitBranch className="h-3.5 w-3.5" />
                                    <span>Apply Accepted</span>
                                </button>
                            )}
                            <button
                                onClick={() => undoLastImportApply()}
                                disabled={!lastImportApplySnapshot}
                                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Undo2 className="h-3.5 w-3.5" />
                                <span>Undo Apply</span>
                            </button>
                            <span className="text-xs text-violet-700">
                                {acceptedSuggestionCount} accepted, {pendingSuggestionCount} pending
                            </span>
                        </div>
                        {previewImportEnvelope && (
                            <div className="mt-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs leading-relaxed text-blue-700">
                                Previewing inferred graph changes. Apply to commit or exit preview to discard.
                            </div>
                        )}
                        {visibleImportEnvelope.hiddenContext.notes?.[0] && (
                            <div className="mt-2 text-xs leading-relaxed text-violet-700">
                                {visibleImportEnvelope.hiddenContext.notes[0]}
                            </div>
                        )}
                        {(visibleImportEnvelope.importWarnings?.length ?? 0) > 0 && (
                            <div className="mt-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs leading-relaxed text-violet-700">
                                {visibleImportEnvelope.importWarnings?.join(' ')}
                            </div>
                        )}
                    </div>
                )}
                {path.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                        <Cpu className="w-12 h-12 opacity-20" />
                        <p>Send a message to start the trunk of the tree.</p>
                    </div>
                ) : (
                    path.map((msg: MessageNode) => (
                        <div
                            key={msg.id}
                            className={`group flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                        >
                            <div className="flex items-center gap-2 mb-1 px-1">
                                {msg.role === 'user' ? (
                                    <>
                                        <span className="text-xs font-semibold text-slate-500">You</span>
                                        <User className="w-3 h-3 text-slate-400" />
                                    </>
                                ) : (
                                    <>
                                        <Cpu className="w-3 h-3 text-purple-500" />
                                        <span className="text-xs font-semibold text-purple-600">Gemini</span>
                                    </>
                                )}
                            </div>
                            <div
                                className={`p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed relative ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-sm'
                                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                                    }`}
                            >
                                {msg.role === 'assistant' ? (
                                    <AssistantMessageBody
                                        events={msg.events}
                                        fallbackText={msg.content}
                                    />
                                ) : (
                                    <div>
                                        {(msg.attachments?.length ?? 0) > 0 && (
                                            <div className="mb-2 flex flex-wrap gap-2">
                                                {msg.attachments!.map((att) => (
                                                    <img
                                                        key={att.id}
                                                        src={`data:${att.mimeType};base64,${att.data}`}
                                                        alt={att.name ?? 'attachment'}
                                                        className="max-h-48 max-w-full rounded-lg object-contain"
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                                    </div>
                                )}

                                <button
                                    onClick={() => setActiveNode(msg.id)}
                                    title="Fork conversation from this node"
                                    className={`absolute top-2 ${msg.role === 'user' ? '-left-10 text-slate-400 hover:text-blue-500' : '-right-10 text-slate-400 hover:text-blue-500'} opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 rounded-full p-1.5 shadow-sm`}
                                >
                                    <CornerDownRight className="w-4 h-4" />
                                </button>
                            </div>

                            <div className={`mt-1.5 flex items-center gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <CopyMessageButton text={msg.role === 'assistant'
                                    ? (getFinalAnswerText(msg.events ?? []) || msg.content)
                                    : msg.content}
                                />
                            </div>

                            {(msg.memoryPatches?.length ?? 0) > 0 && (
                                <div className="mt-1 text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 self-start">
                                    + Memory Patched
                                </div>
                            )}
                        </div>
                    ))
                )}
                {isTyping && (
                    <div className="flex flex-col max-w-[85%] mr-auto items-start">
                        <div className="flex items-center gap-2 mb-1 px-1">
                            <Cpu className="w-3 h-3 text-purple-500 animate-pulse" />
                            <span className="text-xs font-semibold text-purple-600">Gemini</span>
                        </div>
                        <div className="p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed relative bg-white border border-slate-200 text-slate-800 rounded-tl-sm w-full">
                            {streamingDisplayEvents.length > 0 ? (
                                <AssistantMessageBody
                                    events={streamingDisplayEvents}
                                    fallbackText={getFinalAnswerText(streamingDisplayEvents)}
                                    isStreaming
                                />
                            ) : (
                                <div className="flex items-center gap-2 text-slate-400 h-6">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div
                className={`p-4 bg-white border-t border-slate-100 shrink-0 transition-colors ${isDraggingOver ? 'bg-blue-50 border-blue-300' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {!apiKey ? (
                    <div className="flex items-center gap-2 bg-amber-50 rounded-xl p-3 border border-amber-200">
                        <KeyRound className="w-4 h-4 text-amber-600" />
                        <input
                            type="password"
                            placeholder="Paste Google Gemini API Key for MVP..."
                            className="flex-1 bg-transparent text-sm outline-none text-slate-700"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') setApiKey(e.currentTarget.value);
                            }}
                        />
                        <button className="text-xs bg-amber-600 text-white px-2 py-1 rounded shadow-sm hover:bg-amber-700" onClick={(e) => setApiKey((e.currentTarget.previousElementSibling as HTMLInputElement).value)}>Save</button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {/* Attachment preview chips */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {attachments.map((att) => (
                                    <div key={att.id} className="group/chip relative rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                                        <img
                                            src={`data:${att.mimeType};base64,${att.data}`}
                                            alt={att.name ?? 'image'}
                                            className="h-16 w-16 object-cover"
                                        />
                                        <button
                                            onClick={() => removeAttachment(att.id)}
                                            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/chip:opacity-100 transition-opacity"
                                            title="Remove"
                                        >
                                            <X className="h-4 w-4 text-white" />
                                        </button>
                                    </div>
                                ))}
                                {isDraggingOver && (
                                    <div className="h-16 w-16 rounded-lg border-2 border-dashed border-blue-400 flex items-center justify-center">
                                        <ImageIcon className="h-5 w-5 text-blue-400" />
                                    </div>
                                )}
                            </div>
                        )}

                        {isDraggingOver && attachments.length === 0 && (
                            <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-400 bg-blue-50 py-4 text-sm font-medium text-blue-600">
                                <ImageIcon className="h-4 w-4" />
                                Drop image to attach
                            </div>
                        )}

                        <div className="flex items-end gap-2">
                            {/* Hidden file input */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                multiple
                                className="hidden"
                                onChange={handleFileSelect}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isTyping}
                                className="shrink-0 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50 transition-colors"
                                title="Attach image"
                            >
                                <Paperclip className="w-4 h-4" />
                            </button>

                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                onPaste={handlePaste}
                                disabled={isTyping}
                                placeholder={
                                    isDraggingOver ? 'Drop image here...' :
                                    !activeNodeId ? 'Start a new conversation...' :
                                    path[path.length - 1]?.role === 'user' ? 'Try an alternative prompt...' :
                                    'Reply or paste an image...'
                                }
                                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 pl-4 py-3.5 pr-4 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all shadow-inner disabled:opacity-50 overflow-y-auto"
                                rows={1}
                                style={{ maxHeight: '160px' }}
                            />
                            {isTyping ? (
                                <button
                                    onClick={handleStop}
                                    className="shrink-0 p-2.5 rounded-xl bg-slate-700 text-white hover:bg-slate-800 transition-colors shadow-sm"
                                    title="Stop streaming response"
                                >
                                    <Square className="w-4 h-4 fill-current" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSend}
                                    disabled={!input.trim() && attachments.length === 0}
                                    className="shrink-0 p-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                )}
                <div className="mt-2 text-center">
                    <span className="text-[11px] font-medium text-slate-400">
                        {activeNodeId ? 'Active Timeline Checkpoint: ' + activeNodeId.slice(0, 8) : 'No Node Selected'}
                    </span>
                </div>
            </div>
            <SessionsModal isOpen={isSessionsOpen} onClose={() => setIsSessionsOpen(false)} />
            <ImportSuggestionsModal isOpen={isSuggestionsOpen} onClose={() => setIsSuggestionsOpen(false)} />
        </div>
    );
}
