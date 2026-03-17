import { useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { ContextGroup, MessageNode } from '../store/types';
import type { ImportedPathGroup } from '../lib/import/pathGroups';
import { getNodeBadges, getNodeSummary } from '../lib/chatEvents';

interface CustomNodeProps {
    data: {
        node?: MessageNode;
        pathGroup?: ImportedPathGroup;
        isActive: boolean;
        isSelected: boolean;
        groups: ContextGroup[];
        onInspectPathGroup?: (pathGroup: ImportedPathGroup) => void;
        onRenameNode?: (nodeId: string, summary: string) => void;
    };
}

export function CustomNode({ data }: CustomNodeProps) {
    const { node, pathGroup, isActive, isSelected, groups, onInspectPathGroup, onRenameNode } = data;
    const isPathGroup = Boolean(pathGroup);
    const badges = node ? getNodeBadges(node) : [];
    const summary = pathGroup
        ? pathGroup.summary
        : node
            ? node.summary || getNodeSummary(node)
            : '';
    const primaryGroup = groups[0];
    const [isEditing, setIsEditing] = useState(false);
    const [draftSummary, setDraftSummary] = useState(summary);

    useEffect(() => {
        setDraftSummary(summary);
    }, [summary]);

    const commitRename = () => {
        if (!node || !onRenameNode) {
            setIsEditing(false);
            return;
        }
        const nextSummary = draftSummary.trim();
        onRenameNode(node.id, nextSummary || getNodeSummary(node));
        setIsEditing(false);
    };

    return (
        <div className={`relative p-4 rounded-xl shadow-lg w-[250px] border-2 transition-all cursor-pointer bg-white ${
            isSelected
                ? 'border-amber-500 ring-2 ring-amber-200'
                : isActive
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : primaryGroup
                        ? 'border-slate-200 hover:border-slate-400'
                        : 'border-slate-200 hover:border-blue-300'
            }`}>
            {primaryGroup && (
                <div
                    className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
                    style={{ backgroundColor: primaryGroup.color }}
                />
            )}
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-400" />

            <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold uppercase ${
                    isPathGroup
                        ? 'text-indigo-600'
                        : node?.role === 'user'
                            ? 'text-blue-600'
                            : 'text-purple-600'
                }`}>
                    {isPathGroup ? 'path' : node?.role}
                </span>
                <span className="text-xs text-slate-400">
                    {new Date(pathGroup?.endTimestamp ?? node?.timestamp ?? new Date().toISOString()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>

            {pathGroup ? (
                <>
                    <div className="text-sm font-semibold text-slate-800 line-clamp-2">
                        {pathGroup.title}
                    </div>
                    <p className="mt-1 text-sm text-slate-600 line-clamp-3">
                        {summary}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <span>{pathGroup.turnCount} turns</span>
                        {pathGroup.inferred && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">inferred path</span>}
                    </div>
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            onInspectPathGroup?.(pathGroup);
                        }}
                        className="mt-3 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                    >
                        Open Turns
                    </button>
                </>
            ) : (
                isEditing ? (
                    <input
                        autoFocus
                        value={draftSummary}
                        onChange={(event) => setDraftSummary(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRename();
                            } else if (event.key === 'Escape') {
                                setDraftSummary(summary);
                                setIsEditing(false);
                            }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-full rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-400"
                    />
                ) : (
                    <button
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            setIsEditing(true);
                        }}
                        className="w-full text-left text-sm text-slate-700 line-clamp-3"
                        title="Double-click to rename node"
                    >
                        {summary}
                    </button>
                )
            )}

            {groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {groups.map((group) => (
                        <span
                            key={group.id}
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: `${group.color}20`, color: group.color }}
                        >
                            {group.name}
                        </span>
                    ))}
                </div>
            )}

            {!pathGroup && badges.length > 0 && (
                <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
                    {badges.map((badge) => (
                        <span
                            key={badge}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                badge === 'memory'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : badge === 'tool'
                                        ? 'bg-sky-50 text-sky-700'
                                        : badge === 'merge'
                                            ? 'bg-fuchsia-50 text-fuchsia-700'
                                        : badge === 'inferred'
                                            ? 'bg-indigo-50 text-indigo-700'
                                        : badge === 'thinking'
                                            ? 'bg-amber-50 text-amber-700'
                                            : 'bg-rose-50 text-rose-700'
                            }`}
                        >
                            {badge}
                        </span>
                    ))}
                </div>
            )}

            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-400" />
        </div>
    );
}
