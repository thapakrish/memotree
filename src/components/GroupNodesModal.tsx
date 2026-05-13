import { useState } from 'react';
import { FolderTree, X } from 'lucide-react';

const groupColors = [
    '#2563eb',
    '#d97706',
    '#059669',
    '#9333ea',
    '#dc2626',
    '#0891b2',
];

interface GroupNodesModalProps {
    isOpen: boolean;
    selectedCount: number;
    isSubmitting: boolean;
    onClose: () => void;
    onSubmit: (payload: {
        name: string;
        color: string;
    }) => void;
}

export function GroupNodesModal({
    isOpen,
    selectedCount,
    isSubmitting,
    onClose,
    onSubmit,
}: GroupNodesModalProps) {
    const [name, setName] = useState('');
    const [color, setColor] = useState(groupColors[0]);

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Create Group</h2>
                        <p className="text-sm text-slate-500">Group {selectedCount} selected nodes.</p>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-4 px-6 py-5">
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Group Name</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:bg-white"
                            placeholder="Exploratory Arithmetic"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Color</label>
                        <div className="flex flex-wrap gap-3">
                            {groupColors.map((candidate) => (
                                <button
                                    key={candidate}
                                    onClick={() => setColor(candidate)}
                                    className={`h-8 w-8 rounded-full border-2 ${color === candidate ? 'border-slate-900' : 'border-white'}`}
                                    style={{ backgroundColor: candidate }}
                                />
                            ))}
                        </div>
                    </div>

                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
                    <button
                        onClick={onClose}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                    >
                        Cancel
                    </button>
                    <button
                        disabled={!name.trim() || isSubmitting}
                        onClick={() => onSubmit({ name, color })}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <FolderTree className="h-4 w-4" />
                        <span>{isSubmitting ? 'Creating...' : 'Create Group'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
