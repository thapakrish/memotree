import { startTransition, useEffect, useRef, useState } from 'react';
import { Send, CornerDownRight, Cpu, User, KeyRound, Loader2, BrainCircuit } from 'lucide-react';
import type { FunctionCall } from '@google/genai';
import { useGraphStore } from '../store/useGraphStore';
import type { AssistantContentPart, MessageNode } from '../store/types';
import {
    createFunctionResponseContent,
    createModelToolCallContent,
    extractAssistantParts,
    extractFunctionCalls,
    extractThoughtsTokenCount,
    generateGeminiResponseStream,
    generateGeminiResponseStreamFromContents,
    getAssistantText,
    interceptMemoryTool,
} from '../lib/geminiEngine';
import { reconstructMemory } from '../lib/memoryEngine';

function mergeAssistantParts(
    currentParts: AssistantContentPart[],
    nextParts: AssistantContentPart[],
): AssistantContentPart[] {
    const merged = [...currentParts];

    for (const part of nextParts) {
        if (!part.text) {
            continue;
        }

        const previous = merged.at(-1);
        if (
            previous &&
            previous.kind === part.kind &&
            previous.signature === part.signature
        ) {
            merged[merged.length - 1] = {
                ...previous,
                text: previous.text + part.text,
            };
        } else {
            merged.push(part);
        }
    }

    return merged;
}

function getTextSummary(text: string): string {
    if (!text) {
        return 'Tool Execution';
    }

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

async function collectStreamedAssistantResponse(
    stream: AsyncGenerator<import('@google/genai').GenerateContentResponse>,
    setStreamingParts: (parts: AssistantContentPart[]) => void,
    setThoughtsTokenCount: (count: number) => void,
) {
    let assistantParts: AssistantContentPart[] = [];
    let maxThoughtsTokenCount = 0;
    const functionCalls = new Map<string, FunctionCall>();

    for await (const chunk of stream) {
        const chunkParts = extractAssistantParts(chunk);
        if (chunkParts.length > 0) {
            assistantParts = mergeAssistantParts(assistantParts, chunkParts);
            startTransition(() => {
                setStreamingParts(assistantParts);
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
        assistantParts,
        thoughtsTokenCount: maxThoughtsTokenCount,
        functionCalls: [...functionCalls.values()],
    };
}

function AssistantMessageBody({
    parts,
    fallbackText,
    thoughtsTokenCount,
}: {
    parts?: AssistantContentPart[];
    fallbackText: string;
    thoughtsTokenCount?: number;
}) {
    const messageParts = parts ?? [];
    const hasRenderedParts = messageParts.some((part) => part.text.trim().length > 0);

    if (!hasRenderedParts) {
        return <div className="whitespace-pre-wrap">{fallbackText}</div>;
    }

    return (
        <div className="space-y-3">
            {messageParts.map((part, index) => (
                part.kind === 'thought' ? (
                    <details
                        key={`${part.kind}-${part.signature ?? index}-${index}`}
                        className="group rounded-xl border border-amber-200 bg-amber-50/80"
                    >
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 marker:content-none">
                            <BrainCircuit className="h-3.5 w-3.5" />
                            <span className="flex-1">
                                Thinking
                                {index === 0 && thoughtsTokenCount ? ` · ${thoughtsTokenCount.toLocaleString()} tokens` : ''}
                            </span>
                            <span className="text-[10px] normal-case tracking-normal text-amber-600 group-open:hidden">
                                Show
                            </span>
                            <span className="hidden text-[10px] normal-case tracking-normal text-amber-600 group-open:inline">
                                Hide
                            </span>
                        </summary>
                        <div className="border-t border-amber-200 px-3 py-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {part.text}
                        </div>
                    </details>
                ) : (
                    <div
                        key={`${part.kind}-${index}`}
                        className="whitespace-pre-wrap"
                    >
                        {part.text}
                    </div>
                )
            ))}
        </div>
    );
}

export function ChatView() {
    const { activeNodeId, getPath, addNode, setActiveNode, apiKey, setApiKey } = useGraphStore();
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [streamingParts, setStreamingParts] = useState<AssistantContentPart[]>([]);
    const [thoughtsTokenCount, setThoughtsTokenCount] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const path = getPath(activeNodeId);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [streamingParts, isTyping, path.length]);

    const handleSend = async () => {
        if (!input.trim() || !apiKey) return;

        const activeNode = path.length > 0 ? path[path.length - 1] : null;
        const parentId = activeNode?.role === 'user' ? activeNode.parentId : activeNodeId;

        const userNodeId = addNode({
            parentId,
            role: 'user',
            content: input,
            memoryPatches: [],
            summary: getTextSummary(input),
        });

        setInput('');
        setIsTyping(true);
        setStreamingParts([]);
        setThoughtsTokenCount(0);

        try {
            const newPath = getPath(userNodeId);
            const memoryState = reconstructMemory(newPath);
            const initialStream = await generateGeminiResponseStream(newPath, memoryState, apiKey);
            const initialResponse = await collectStreamedAssistantResponse(
                initialStream,
                setStreamingParts,
                setThoughtsTokenCount,
            );

            let assistantParts = initialResponse.assistantParts;
            let maxThoughtsTokenCount = initialResponse.thoughtsTokenCount;

            let nextMemoryState = memoryState;
            const patches = [];
            const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];

            for (const call of initialResponse.functionCalls) {
                if (call.name === 'text_editor') {
                    const { patch, updatedMemory } = interceptMemoryTool(
                        normalizeToolArgs(call.args),
                        nextMemoryState,
                    );
                    patches.push(patch);
                    nextMemoryState = updatedMemory;
                    functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                            output: `Updated ${normalizeToolArgs(call.args).path ?? '/memories/facts.json'}`,
                            fileText: updatedMemory,
                        },
                    });
                }
            }

            if (initialResponse.functionCalls.length > 0 && functionResponses.length > 0) {
                const followUpContents = [
                    ...newPath.map((node) => ({
                        role: node.role === 'assistant' ? 'model' : 'user',
                        parts: node.role === 'assistant' && node.assistantParts
                            ? node.assistantParts.map((part) => ({
                                text: part.text,
                                thought: part.kind === 'thought' ? true : undefined,
                                thoughtSignature: part.signature,
                            }))
                            : [{ text: node.content }],
                    })),
                    createModelToolCallContent(assistantParts, initialResponse.functionCalls),
                    createFunctionResponseContent(functionResponses),
                ];

                setStreamingParts(assistantParts);

                const followUpStream = await generateGeminiResponseStreamFromContents(
                    followUpContents,
                    nextMemoryState,
                    apiKey,
                );
                const followUpResponse = await collectStreamedAssistantResponse(
                    followUpStream,
                    setStreamingParts,
                    setThoughtsTokenCount,
                );

                assistantParts = mergeAssistantParts(assistantParts, followUpResponse.assistantParts);
                maxThoughtsTokenCount = Math.max(
                    maxThoughtsTokenCount,
                    followUpResponse.thoughtsTokenCount,
                );
            }

            const assistantText = getAssistantText(assistantParts);

            addNode({
                parentId: userNodeId,
                role: 'assistant',
                content: assistantText || 'Processed tool call.',
                assistantParts,
                thoughtsTokenCount: maxThoughtsTokenCount,
                memoryPatches: patches,
                summary: getTextSummary(assistantText),
            });
        } catch (err) {
            console.error(err);
            alert('API request failed. Check API Key or console.');
        } finally {
            setIsTyping(false);
            setStreamingParts([]);
            setThoughtsTokenCount(0);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-white border-r border-slate-200 shadow-sm z-20">
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 bg-white shadow-sm shrink-0">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-800">MemoTree</h1>
                    <p className="text-xs font-medium text-slate-400">Time-Traveling LLM Interface</p>
                </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scroll-smooth">
                {path.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                        <Cpu className="w-12 h-12 opacity-20" />
                        <p>Send a message to start the trunk of the tree.</p>
                    </div>
                ) : (
                    path.map((msg: MessageNode) => (
                        <div
                            key={msg.id}
                            className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
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
                                className={`p-4 rounded-2xl shadow-sm text-[15px] leading-relaxed relative group ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-sm'
                                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                                    }`}
                            >
                                {msg.role === 'assistant' ? (
                                    <AssistantMessageBody
                                        parts={msg.assistantParts}
                                        fallbackText={msg.content}
                                        thoughtsTokenCount={msg.thoughtsTokenCount}
                                    />
                                ) : (
                                    <div className="whitespace-pre-wrap">{msg.content}</div>
                                )}

                                <button
                                    onClick={() => setActiveNode(msg.id)}
                                    title="Fork conversation from this node"
                                    className={`absolute top-2 ${msg.role === 'user' ? '-left-10 text-slate-400 hover:text-blue-500' : '-right-10 text-slate-400 hover:text-blue-500'} opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-slate-200 rounded-full p-1.5 shadow-sm`}
                                >
                                    <CornerDownRight className="w-4 h-4" />
                                </button>
                            </div>

                            {msg.memoryPatches.length > 0 && (
                                <div className="mt-2 text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 self-start">
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
                            {streamingParts.length > 0 ? (
                                <AssistantMessageBody
                                    parts={streamingParts}
                                    fallbackText=""
                                    thoughtsTokenCount={thoughtsTokenCount}
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

            <div className="p-4 bg-white border-t border-slate-100 shrink-0">
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
                    <div className="relative flex items-center">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            disabled={isTyping}
                            placeholder={
                                !activeNodeId ? 'Start a new conversation...' :
                                path[path.length - 1]?.role === 'user' ? 'Try an alternative prompt...' :
                                'Reply to this message...'
                            }
                            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 pl-4 py-3.5 pr-12 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 transition-all shadow-inner disabled:opacity-50"
                            rows={1}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isTyping}
                            className="absolute right-2 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                )}
                <div className="mt-2 text-center">
                    <span className="text-[11px] font-medium text-slate-400">
                        {activeNodeId ? 'Active Timeline Checkpoint: ' + activeNodeId.slice(0, 8) : 'No Node Selected'}
                    </span>
                </div>
            </div>
        </div>
    );
}
