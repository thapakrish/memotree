import { useState } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronRight, Database, MessageSquare, Paperclip, Layers, Lock, Zap, Scissors, X, AlertTriangle } from 'lucide-react';
import type { AttachmentPart, CompactionBlock, ImportedConversationEnvelope, MessageNode } from '../store/types';
import { buildSystemInstruction, countTokens } from '../lib/geminiEngine';
import { reconstructMemory } from '../lib/memoryEngine';

const COMPACT_WARNING_TOKENS = 80_000;
const COMPACT_DANGER_TOKENS = 300_000;

// Rough token estimate: ~4 chars per token
function roughTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function formatTokens(n: number): string {
    return n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`;
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface TokenBarProps {
    cacheableTokens: number;
    conversationTokens: number;
    attachmentTokens: number;
}

function TokenBar({ cacheableTokens, conversationTokens, attachmentTokens }: TokenBarProps) {
    const total = cacheableTokens + conversationTokens + attachmentTokens;
    if (total === 0) return null;
    const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
    return (
        <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-400" style={{ width: pct(cacheableTokens) }} title={`Cacheable: ${formatTokens(cacheableTokens)} tokens`} />
            <div className="h-full bg-blue-400" style={{ width: pct(conversationTokens) }} title={`Conversation: ${formatTokens(conversationTokens)} tokens`} />
            {attachmentTokens > 0 && (
                <div className="h-full bg-violet-400" style={{ width: pct(attachmentTokens) }} title={`Attachments: ${formatTokens(attachmentTokens)} tokens`} />
            )}
        </div>
    );
}

interface ContextInspectorProps {
    path: MessageNode[];
    pendingInput: string;
    pendingAttachments: AttachmentPart[];
    apiKey: string | null;
    importEnvelope?: ImportedConversationEnvelope;
    compactions: Record<string, CompactionBlock>;
    isCompacting: boolean;
    canCompact: boolean;
    onCompactPath: () => void;
    onRemoveCompaction: (id: string) => void;
}

export function ContextInspector({ path, pendingInput, pendingAttachments, apiKey, importEnvelope, compactions, isCompacting, canCompact, onCompactPath, onRemoveCompaction }: ContextInspectorProps) {
    const [exactTokens, setExactTokens] = useState<number | null>(null);
    const [isCounting, setIsCounting] = useState(false);
    const [countError, setCountError] = useState<string | null>(null);
    const [memoryExpanded, setMemoryExpanded] = useState(false);

    const memoryState = reconstructMemory(path);
    const systemInstruction = buildSystemInstruction(memoryState);

    // Rough estimates
    const cacheableTokens = roughTokens(systemInstruction);
    const conversationTokens = path.reduce((sum, node) => {
        const textLen = node.content.length + (node.events ?? []).reduce((s, e) =>
            s + ('text' in e ? e.text.length : 0), 0);
        return sum + roughTokens('x'.repeat(textLen));
    }, 0);
    const pendingInputTokens = pendingInput.trim() ? roughTokens(pendingInput.trim()) : 0;
    // Attachments: base64 length * 0.75 = raw bytes; Gemini charges ~258 tokens per image tile (768px)
    const attachmentTokenEstimate = pendingAttachments.reduce((sum, att) => {
        const rawBytes = att.data.length * 0.75;
        const estimatedTiles = Math.ceil(rawBytes / (768 * 768 * 3));
        return sum + Math.max(258, estimatedTiles * 258);
    }, 0);
    const totalRoughTokens = cacheableTokens + conversationTokens + pendingInputTokens + attachmentTokenEstimate;

    const userNodes = path.filter((n) => n.role === 'user').length;
    const assistantNodes = path.filter((n) => n.role === 'assistant').length;
    const totalPatches = path.reduce((sum, n) => sum + (n.memoryPatches?.length ?? 0), 0);
    const totalAttachmentsInPath = path.reduce((sum, n) => sum + (n.attachments?.length ?? 0), 0);

    const handleCountExact = async () => {
        if (!apiKey) return;
        setIsCounting(true);
        setCountError(null);
        try {
            const total = await countTokens(path, memoryState, apiKey, compactions, pendingInput, pendingAttachments);
            setExactTokens(total);
        } catch (err) {
            setCountError(err instanceof Error ? err.message : 'Count failed');
        } finally {
            setIsCounting(false);
        }
    };

    const isOverWarning = totalRoughTokens > COMPACT_WARNING_TOKENS;
    const isOverDanger = totalRoughTokens > COMPACT_DANGER_TOKENS;
    const activeCompactionBlocks = Object.values(compactions).filter((b) =>
        b.nodeIds.every((id) => new Set(path.map((n) => n.id)).has(id))
    );

    const displayTotal = exactTokens !== null ? exactTokens : totalRoughTokens;
    const isExact = exactTokens !== null;

    return (
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 text-[13px] text-slate-700 space-y-3">

            {/* Token summary row */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-slate-800">
                        {isExact ? displayTotal.toLocaleString() : formatTokens(displayTotal)} tokens
                        {!isExact && <span className="ml-1 text-[11px] font-normal text-slate-400">(est.)</span>}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" />
                        <span>Cacheable {formatTokens(cacheableTokens)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="h-2 w-2 rounded-full bg-blue-400 inline-block" />
                        <span>Conversation {formatTokens(conversationTokens)}</span>
                    </div>
                    {pendingInputTokens > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="h-2 w-2 rounded-full bg-cyan-400 inline-block" />
                            <span>Draft {formatTokens(pendingInputTokens)}</span>
                        </div>
                    )}
                    {attachmentTokenEstimate > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="h-2 w-2 rounded-full bg-violet-400 inline-block" />
                            <span>Images {formatTokens(attachmentTokenEstimate)}</span>
                        </div>
                    )}
                </div>
                <button
                    onClick={handleCountExact}
                    disabled={isCounting || !apiKey}
                    className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 transition-colors"
                    title={!apiKey ? 'API key required' : 'Count exact tokens via Gemini API'}
                >
                    {isCounting
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <RefreshCw className="h-3 w-3" />
                    }
                    {isExact ? 'Recount' : 'Count exact'}
                </button>
            </div>

            <TokenBar
                cacheableTokens={cacheableTokens}
                conversationTokens={conversationTokens}
                attachmentTokens={attachmentTokenEstimate}
            />

            {countError && (
                <p className="text-[11px] text-red-500">{countError}</p>
            )}

            {/* Breakdown rows */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                <div className="flex items-center gap-1.5 text-slate-600">
                    <MessageSquare className="h-3 w-3 shrink-0 text-slate-400" />
                    <span>Path: <span className="font-medium text-slate-800">{path.length}</span> nodes</span>
                    <span className="text-slate-400">({userNodes}u / {assistantNodes}a)</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                    <Database className="h-3 w-3 shrink-0 text-slate-400" />
                    <span>Memory: <span className="font-medium text-slate-800">{formatBytes(memoryState.length)}</span></span>
                    {totalPatches > 0 && <span className="text-slate-400">({totalPatches} patches)</span>}
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                    <Lock className="h-3 w-3 shrink-0 text-emerald-500" />
                    <span>Cacheable prefix: <span className="font-medium text-slate-800">{formatTokens(cacheableTokens)}</span></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                    <Zap className="h-3 w-3 shrink-0 text-blue-400" />
                    <span>Dynamic suffix: <span className="font-medium text-slate-800">{formatTokens(conversationTokens)}</span></span>
                </div>
                {pendingInputTokens > 0 && (
                    <div className="flex items-center gap-1.5 text-slate-600">
                        <MessageSquare className="h-3 w-3 shrink-0 text-cyan-400" />
                        <span>Pending draft: <span className="font-medium text-slate-800">{formatTokens(pendingInputTokens)}</span></span>
                    </div>
                )}
                {(pendingAttachments.length > 0 || totalAttachmentsInPath > 0) && (
                    <div className="flex items-center gap-1.5 text-slate-600 col-span-2">
                        <Paperclip className="h-3 w-3 shrink-0 text-violet-500" />
                        <span>
                            {pendingAttachments.length > 0 && (
                                <><span className="font-medium text-slate-800">{pendingAttachments.length}</span> pending image{pendingAttachments.length !== 1 ? 's' : ''}</>
                            )}
                            {pendingAttachments.length > 0 && totalAttachmentsInPath > 0 && ', '}
                            {totalAttachmentsInPath > 0 && (
                                <><span className="font-medium text-slate-800">{totalAttachmentsInPath}</span> in path</>
                            )}
                        </span>
                    </div>
                )}
                {importEnvelope && (
                    <div className="flex items-center gap-1.5 text-slate-600 col-span-2">
                        <Layers className="h-3 w-3 shrink-0 text-violet-400" />
                        <span>
                            Imported from <span className="font-medium text-slate-800">{importEnvelope.sourcePlatform}</span>
                            {' · '}<span className="font-medium text-slate-800">{importEnvelope.messageCount}</span> turns
                            {importEnvelope.parserConfidence && ` · ${importEnvelope.parserConfidence} confidence`}
                        </span>
                    </div>
                )}
            </div>

            {/* Memory preview */}
            {memoryState && memoryState !== '{}' && (
                <div>
                    <button
                        onClick={() => setMemoryExpanded((v) => !v)}
                        className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                    >
                        {memoryExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        Memory state
                    </button>
                    {memoryExpanded && (
                        <pre className="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-emerald-300 font-mono">
                            {memoryState}
                        </pre>
                    )}
                </div>
            )}

            {/* Compaction section */}
            <div className="border-t border-slate-200 pt-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        {isOverDanger && (
                            <span className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                                <AlertTriangle className="h-3 w-3" />
                                Context very large
                            </span>
                        )}
                        {isOverWarning && !isOverDanger && (
                            <span className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                                <AlertTriangle className="h-3 w-3" />
                                Context growing
                            </span>
                        )}
                        {activeCompactionBlocks.length > 0 && (
                            <span className="text-[11px] text-slate-500">
                                {activeCompactionBlocks.length} compaction{activeCompactionBlocks.length !== 1 ? 's' : ''} active
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onCompactPath}
                        disabled={!canCompact || isCompacting || !apiKey}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-40 transition-colors"
                        title={!apiKey ? 'API key required' : !canCompact ? 'Path too short to compact' : 'Compact older context into a summary'}
                    >
                        {isCompacting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                        Compact older context
                    </button>
                </div>

                {activeCompactionBlocks.length > 0 && (
                    <div className="space-y-1.5">
                        {activeCompactionBlocks.map((block) => (
                            <div key={block.id} className="flex items-start gap-2 rounded-lg bg-violet-50 border border-violet-100 px-2.5 py-2">
                                <Scissors className="h-3 w-3 shrink-0 text-violet-400 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-medium text-violet-700">
                                        {block.nodeIds.length} nodes compacted
                                        {block.tokensBefore && ` · saved ~${formatTokens(block.tokensBefore)} tokens`}
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-violet-600 line-clamp-2 leading-relaxed">
                                        {block.summary}
                                    </p>
                                </div>
                                <button
                                    onClick={() => onRemoveCompaction(block.id)}
                                    className="shrink-0 rounded p-0.5 text-violet-400 hover:text-violet-700 hover:bg-violet-100 transition-colors"
                                    title="Remove compaction (restores full context)"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
