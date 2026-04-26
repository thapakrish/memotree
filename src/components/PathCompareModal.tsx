import { useMemo } from 'react';
import { X, GitBranch, Database, MessageSquare, User, Cpu, Wrench, CheckCircle2, CircleAlert } from 'lucide-react';
import type { ChatEvent, MessageNode } from '../store/types';
import { computePathDiff, computeMemoryDiff } from '../lib/pathDiff';
import { reconstructMemory } from '../lib/memoryEngine';
import { getFinalAnswerText } from '../lib/chatEvents';

interface PathCompareModalProps {
    isOpen: boolean;
    leftNode: MessageNode | undefined;
    rightNode: MessageNode | undefined;
    getPath: (nodeId: string | null) => MessageNode[];
    onClose: () => void;
    onNavigate: (nodeId: string) => void;
}

function RoleIcon({ role }: { role: 'user' | 'assistant' | 'system' }) {
    if (role === 'user') return <User className="h-3 w-3 shrink-0 text-blue-500" />;
    if (role === 'assistant') return <Cpu className="h-3 w-3 shrink-0 text-violet-500" />;
    return null;
}

function NodeCard({ node, side }: { node: MessageNode; side: 'left' | 'right' }) {
    const text = node.role === 'assistant'
        ? (getFinalAnswerText(node.events) || node.content)
        : node.content;

    const hasToolCalls = node.events?.some((e) => e.kind === 'tool_call');
    const hasMemoryPatch = (node.memoryPatches?.length ?? 0) > 0;

    const borderColor = side === 'left' ? 'border-blue-200' : 'border-emerald-200';
    const bgColor = side === 'left' ? 'bg-blue-50/60' : 'bg-emerald-50/60';

    return (
        <div className={`rounded-xl border ${borderColor} ${bgColor} px-3 py-2.5 text-[12px] space-y-1.5`}>
            <div className="flex items-center gap-1.5">
                <RoleIcon role={node.role} />
                <span className="font-medium text-slate-500 capitalize">{node.role}</span>
                {hasToolCalls && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-sky-600">
                        <Wrench className="h-2.5 w-2.5" /> tool
                    </span>
                )}
                {hasMemoryPatch && (
                    <span className="flex items-center gap-1 text-[10px] text-violet-600">
                        <Database className="h-2.5 w-2.5" /> mem
                    </span>
                )}
            </div>
            <p className="text-slate-700 leading-relaxed line-clamp-4 whitespace-pre-wrap">{text || '(empty)'}</p>
        </div>
    );
}

function ToolResultBadge({ status, summary }: { status: 'success' | 'error'; summary: string }) {
    return (
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]">
            {status === 'success'
                ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                : <CircleAlert className="h-3 w-3 shrink-0 text-red-500" />}
            <span className="text-slate-600 truncate max-w-[180px]">{summary}</span>
        </div>
    );
}

function MemoryDiffView({ left, right }: { left: string; right: string }) {
    const diff = useMemo(() => computeMemoryDiff(left, right), [left, right]);

    if (diff.identical) {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 font-mono">
                Memory state identical at both endpoints
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2.5 text-[11px] font-mono leading-relaxed overflow-x-auto">
            {diff.segments.map((seg, i) => {
                if (seg.side === 'common') {
                    return <span key={i} className="text-slate-300">{seg.text}</span>;
                }
                if (seg.side === 'left') {
                    return (
                        <span key={i} className="bg-red-900/60 text-red-200 rounded-sm">
                            {seg.text}
                        </span>
                    );
                }
                return (
                    <span key={i} className="bg-emerald-900/60 text-emerald-200 rounded-sm">
                        {seg.text}
                    </span>
                );
            })}
        </div>
    );
}

function PathColumn({
    label,
    node,
    path,
    divergence,
    memoryState,
    side,
    onNavigate,
}: {
    label: string;
    node: MessageNode;
    path: MessageNode[];
    divergence: MessageNode[];
    memoryState: string;
    side: 'left' | 'right';
    onNavigate: (id: string) => void;
}) {
    const accentBorder = side === 'left' ? 'border-blue-300' : 'border-emerald-300';
    const accentText = side === 'left' ? 'text-blue-700' : 'text-emerald-700';
    const accentBg = side === 'left' ? 'bg-blue-50' : 'bg-emerald-50';
    const buttonHover = side === 'left'
        ? 'hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50'
        : 'hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50';

    type ToolResultEvent = Extract<ChatEvent, { kind: 'tool_result' }>;
    const toolResults = path.flatMap((n) =>
        (n.events ?? []).filter((e): e is ToolResultEvent => e.kind === 'tool_result')
    );

    const finalAnswer = getFinalAnswerText(node.events) || node.content;
    const memoryPatches = path.reduce((s, n) => s + (n.memoryPatches?.length ?? 0), 0);

    return (
        <div className="flex flex-col gap-4 min-w-0">
            {/* Header */}
            <div className={`flex items-center justify-between rounded-xl border ${accentBorder} ${accentBg} px-3 py-2`}>
                <div className="flex items-center gap-2">
                    <GitBranch className={`h-4 w-4 ${accentText}`} />
                    <span className={`text-[13px] font-semibold ${accentText}`}>{label}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{divergence.length} node{divergence.length !== 1 ? 's' : ''}</span>
                    {memoryPatches > 0 && <span>· {memoryPatches} patch{memoryPatches !== 1 ? 'es' : ''}</span>}
                </div>
            </div>

            {/* Divergent nodes */}
            <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                    <MessageSquare className="h-3 w-3" />
                    <span>Branch path ({divergence.length} nodes)</span>
                </div>
                {divergence.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-400">
                        No divergent nodes
                    </div>
                ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {divergence.map((n) => (
                            <NodeCard key={n.id} node={n} side={side} />
                        ))}
                    </div>
                )}
            </div>

            {/* Tool results summary */}
            {toolResults.length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                        Tool results ({toolResults.length})
                    </div>
                    <div className="space-y-1">
                        {toolResults.slice(0, 4).map((e, i) => (
                            <ToolResultBadge
                                key={i}
                                status={e.status}
                                summary={e.summary}
                            />
                        ))}
                        {toolResults.length > 4 && (
                            <div className="text-[11px] text-slate-400">+{toolResults.length - 4} more</div>
                        )}
                    </div>
                </div>
            )}

            {/* Memory state */}
            <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                    <Database className="h-3 w-3" />
                    <span>Memory at endpoint</span>
                </div>
                <pre className={`rounded-xl border ${accentBorder} bg-slate-900 px-3 py-2 text-[11px] font-mono leading-relaxed text-emerald-300 max-h-32 overflow-y-auto`}>
                    {memoryState && memoryState !== '{}' ? memoryState : '(empty)'}
                </pre>
            </div>

            {/* Final answer */}
            <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Final answer</div>
                <div className={`rounded-xl border ${accentBorder} ${accentBg} px-3 py-2.5 text-[12px] text-slate-700 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap`}>
                    {finalAnswer || '(no text response)'}
                </div>
            </div>

            {/* Navigate button */}
            <button
                onClick={() => onNavigate(node.id)}
                className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors ${buttonHover}`}
            >
                Jump to this node
            </button>
        </div>
    );
}

export function PathCompareModal({
    isOpen,
    leftNode,
    rightNode,
    getPath,
    onClose,
    onNavigate,
}: PathCompareModalProps) {
    const leftPath = useMemo(() => leftNode ? getPath(leftNode.id) : [], [leftNode, getPath]);
    const rightPath = useMemo(() => rightNode ? getPath(rightNode.id) : [], [rightNode, getPath]);

    const diff = useMemo(() => computePathDiff(leftPath, rightPath), [leftPath, rightPath]);

    const leftMemory = useMemo(() => reconstructMemory(leftPath), [leftPath]);
    const rightMemory = useMemo(() => reconstructMemory(rightPath), [rightPath]);

    if (!isOpen || !leftNode || !rightNode) return null;

    const leftLabel = `Branch A · ${leftNode.id.slice(0, 6)}`;
    const rightLabel = `Branch B · ${rightNode.id.slice(0, 6)}`;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-4 px-4 sm:py-8">
            <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <GitBranch className="h-5 w-5 text-slate-600" />
                        <div>
                            <h2 className="text-[15px] font-semibold text-slate-800">Path Comparison</h2>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {diff.commonPrefix.length} shared nodes · diverges after{' '}
                                <span className="font-medium text-slate-600">
                                    {diff.commonAncestor
                                        ? `node ${diff.commonAncestor.id.slice(0, 6)}`
                                        : 'root'}
                                </span>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Common prefix summary */}
                {diff.commonPrefix.length > 0 && (
                    <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/60">
                        <div className="flex items-center gap-2 text-[12px] text-slate-500">
                            <span className="font-medium text-slate-600">{diff.commonPrefix.length} shared nodes</span>
                            <span>·</span>
                            <span>
                                {diff.commonPrefix.filter((n) => n.role === 'user').length}u /
                                {diff.commonPrefix.filter((n) => n.role === 'assistant').length}a
                            </span>
                            {diff.commonAncestor && (
                                <>
                                    <span>·</span>
                                    <span>last common: <span className="font-mono">{diff.commonAncestor.id.slice(0, 8)}</span></span>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Two-column comparison */}
                <div className="grid grid-cols-1 gap-6 p-4 min-h-0 sm:grid-cols-2 sm:p-6">
                    {leftNode && (
                        <PathColumn
                            label={leftLabel}
                            node={leftNode}
                            path={leftPath}
                            divergence={diff.leftDivergence}
                            memoryState={leftMemory}
                            side="left"
                            onNavigate={(id) => { onNavigate(id); onClose(); }}
                        />
                    )}
                    {rightNode && (
                        <PathColumn
                            label={rightLabel}
                            node={rightNode}
                            path={rightPath}
                            divergence={diff.rightDivergence}
                            memoryState={rightMemory}
                            side="right"
                            onNavigate={(id) => { onNavigate(id); onClose(); }}
                        />
                    )}
                </div>

                {/* Memory diff */}
                <div className="px-6 pb-6 space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                        <Database className="h-3 w-3" />
                        <span>Memory diff</span>
                        <span className="text-[10px] normal-case tracking-normal">
                            (<span className="text-red-400">red = only in A</span>,{' '}
                            <span className="text-emerald-400">green = only in B</span>)
                        </span>
                    </div>
                    <MemoryDiffView left={leftMemory} right={rightMemory} />
                </div>
            </div>
        </div>
    );
}
