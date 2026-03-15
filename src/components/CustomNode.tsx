import { Handle, Position } from '@xyflow/react';
import type { MessageNode } from '../store/types';
import { getNodeBadges, getNodeSummary } from '../lib/chatEvents';

interface CustomNodeProps {
    data: {
        node: MessageNode;
        isActive: boolean;
        isSelected: boolean;
    };
}

export function CustomNode({ data }: CustomNodeProps) {
    const { node, isActive, isSelected } = data;
    const badges = getNodeBadges(node);
    const summary = node.summary || getNodeSummary(node);

    return (
        <div className={`p-4 rounded-xl shadow-lg w-[250px] border-2 transition-all cursor-pointer bg-white ${
            isSelected
                ? 'border-amber-500 ring-2 ring-amber-200'
                : isActive
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : 'border-slate-200 hover:border-blue-300'
            }`}>
            <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-400" />

            <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold uppercase ${node.role === 'user' ? 'text-blue-600' : 'text-purple-600'}`}>
                    {node.role}
                </span>
                <span className="text-xs text-slate-400">
                    {new Date(node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>

            <p className="text-sm text-slate-700 line-clamp-3">
                {summary}
            </p>

            {badges.length > 0 && (
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
