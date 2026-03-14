import { Handle, Position } from '@xyflow/react';
import type { MessageNode } from '../store/types';

interface CustomNodeProps {
    data: {
        node: MessageNode;
        isActive: boolean;
    };
}

export function CustomNode({ data }: CustomNodeProps) {
    const { node, isActive } = data;

    return (
        <div className={`p-4 rounded-xl shadow-lg w-[250px] border-2 transition-all cursor-pointer bg-white ${isActive ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-blue-300'
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
                {node.summary || node.content}
            </p>

            {node.memoryPatches.length > 0 && (
                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs text-slate-500 font-medium">Memory Updated</span>
                </div>
            )}

            <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-400" />
        </div>
    );
}
