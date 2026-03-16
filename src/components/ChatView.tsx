import { startTransition, useEffect, useRef, useState } from 'react';
import { Send, CornerDownRight, Cpu, User, KeyRound, Loader2, BrainCircuit, Wrench, CheckCircle2, CircleAlert, FolderOpen } from 'lucide-react';
import type { Content, FunctionCall, GenerateContentResponse, Part } from '@google/genai';
import { useGraphStore } from '../store/useGraphStore';
import type { ChatEvent, MessageNode } from '../store/types';
import {
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

function toReplayParts(msg: MessageNode) {
    if (msg.role !== 'assistant') {
        return [{ text: msg.content }] as Part[];
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

function AssistantMessageBody({
    events,
    fallbackText,
}: {
    events?: ChatEvent[];
    fallbackText: string;
}) {
    const messageEvents = events ?? [];

    if (messageEvents.length === 0) {
        return <div className="whitespace-pre-wrap">{fallbackText}</div>;
    }

    return (
        <div className="space-y-3">
            {messageEvents.map((event, index) => {
                switch (event.kind) {
                    case 'thought':
                        return (
                            <details
                                key={`${event.kind}-${event.signature ?? index}-${index}`}
                                className="group rounded-xl border border-amber-200 bg-amber-50/80"
                            >
                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 marker:content-none">
                                    <BrainCircuit className="h-3.5 w-3.5" />
                                    <span className="flex-1">
                                        Thinking
                                        {event.tokenCount ? ` · ${event.tokenCount.toLocaleString()} tokens` : ''}
                                    </span>
                                    <span className="text-[10px] normal-case tracking-normal text-amber-600 group-open:hidden">Show</span>
                                    <span className="hidden text-[10px] normal-case tracking-normal text-amber-600 group-open:inline">Hide</span>
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
                            <details key={`${event.kind}-${event.callId ?? index}`} className="group rounded-xl border border-emerald-200 bg-emerald-50/80">
                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 marker:content-none">
                                    {event.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                                    <span className="flex-1">{event.summary}</span>
                                    <span className="text-[10px] normal-case tracking-normal text-emerald-600 group-open:hidden">Show</span>
                                    <span className="hidden text-[10px] normal-case tracking-normal text-emerald-600 group-open:inline">Hide</span>
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
                            <div key={`${event.kind}-${index}`} className="whitespace-pre-wrap">
                                {event.text}
                            </div>
                        );
                }
            })}
        </div>
    );
}

export function ChatView() {
    const { activeNodeId, getPath, addNode, setActiveNode, apiKey, setApiKey } = useGraphStore();
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [streamingEvents, setStreamingEvents] = useState<ChatEvent[]>([]);
    const [thoughtsTokenCount, setThoughtsTokenCount] = useState(0);
    const [isSessionsOpen, setIsSessionsOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const path = getPath(activeNodeId);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [streamingEvents, isTyping, path.length]);

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
        setStreamingEvents([]);
        setThoughtsTokenCount(0);

        try {
            const newPath = getPath(userNodeId);
            const memoryState = reconstructMemory(newPath);
            const initialStream = await generateGeminiResponseStream(newPath, memoryState, apiKey);
            const initialResponse = await collectStreamedAssistantResponse(
                initialStream,
                setStreamingEvents,
                setThoughtsTokenCount,
            );

            let events = initialResponse.events;
            let nextMemoryState = memoryState;
            const patches = [];
            const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];

            for (const call of initialResponse.functionCalls) {
                if (call.name === 'text_editor') {
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
                    setStreamingEvents(events);

                    functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                            output: toolResultEvent.summary,
                            fileText: updatedMemory,
                        },
                    });
                }
            }

            if (initialResponse.functionCalls.length > 0 && functionResponses.length > 0) {
                const followUpContents: Content[] = [
                    ...newPath.map((node) => ({
                        role: node.role === 'assistant' ? 'model' : 'user',
                        parts: toReplayParts(node),
                    })),
                    createModelToolCallContent(events, initialResponse.functionCalls),
                    createFunctionResponseContent(functionResponses),
                ];

                const followUpStream = await generateGeminiResponseStreamFromContents(
                    followUpContents,
                    nextMemoryState,
                    apiKey,
                );
                const followUpResponse = await collectStreamedAssistantResponse(
                    followUpStream,
                    setStreamingEvents,
                    setThoughtsTokenCount,
                );

                events = mergeEvents(events, followUpResponse.events);
            }

            const assistantText = getAssistantText(events) || 'Tool ran with no user-facing answer';

            addNode({
                parentId: userNodeId,
                role: 'assistant',
                content: assistantText,
                events,
                memoryPatches: patches,
                summary: getNodeSummary({ role: 'assistant', events, content: assistantText }),
            });
        } catch (err) {
            console.error(err);
            alert('API request failed. Check API Key or console.');
        } finally {
            setIsTyping(false);
            setStreamingEvents([]);
            setThoughtsTokenCount(0);
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
                <button
                    onClick={() => setIsSessionsOpen(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Sessions</span>
                </button>
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
                                        events={msg.events}
                                        fallbackText={msg.content}
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

                            {(msg.memoryPatches?.length ?? 0) > 0 && (
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
                            {streamingDisplayEvents.length > 0 ? (
                                <AssistantMessageBody
                                    events={streamingDisplayEvents}
                                    fallbackText={getFinalAnswerText(streamingDisplayEvents)}
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
            <SessionsModal isOpen={isSessionsOpen} onClose={() => setIsSessionsOpen(false)} />
        </div>
    );
}
