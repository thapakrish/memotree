import { useState } from 'react';
import { GitMerge, X } from 'lucide-react';
import type { MergeContextMode, MessageNode } from '../store/types';

interface MergeBranchesModalProps {
    isOpen: boolean;
    leftNode?: MessageNode;
    rightNode?: MessageNode;
    isSubmitting: boolean;
    onClose: () => void;
    onSubmit: (instruction: string, mode: MergeContextMode) => Promise<void>;
}

const modes: Array<{ value: MergeContextMode; label: string; description: string }> = [
    { value: 'compact', label: 'Compact (Recommended)', description: 'Carry curated branch summaries forward for lower token usage and better caching.' },
    { value: 'full', label: 'Full Detail', description: 'Carry the full divergent branch history into the merge context.' },
    { value: 'artifacts', label: 'Results Only', description: 'Carry final outputs and tool artifacts only.' },
];

export function MergeBranchesModal({
    isOpen,
    leftNode,
    rightNode,
    isSubmitting,
    onClose,
    onSubmit,
}: MergeBranchesModalProps) {
    const [instruction, setInstruction] = useState('Combine the results from both branches into a single answer.');
    const [mode, setMode] = useState<MergeContextMode>('compact');

    if (!isOpen || !leftNode || !rightNode) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm sm:items-center" onClick={onClose}>
            <div
                className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:mx-4 sm:rounded-2xl"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex justify-center pt-3 sm:hidden">
                    <div className="h-1 w-10 rounded-full bg-slate-200" />
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Merge Branches</h2>
                        <p className="text-sm text-slate-500">Create a merge node that carries curated context from both selected branches.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
                    {[leftNode, rightNode].map((node, index) => (
                        <div key={node.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                Branch {index === 0 ? 'A' : 'B'}
                            </div>
                            <div className="text-sm font-medium text-slate-800">{node.summary || node.content}</div>
                            <div className="mt-1 text-xs text-slate-400">{node.id.slice(0, 8)}</div>
                        </div>
                    ))}
                </div>

                <div className="space-y-4 overflow-y-auto px-6 pb-6">
                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Merge Request
                        </label>
                        <textarea
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:bg-white"
                            placeholder="What should the merged branch do with both source branches?"
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Branch Context Mode
                        </label>
                        <div className="space-y-2">
                            {modes.map((option) => (
                                <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-blue-300 hover:bg-slate-50">
                                    <input
                                        type="radio"
                                        name="merge-mode"
                                        value={option.value}
                                        checked={mode === option.value}
                                        onChange={() => setMode(option.value)}
                                        className="mt-1"
                                    />
                                    <div>
                                        <div className="text-sm font-medium text-slate-800">{option.label}</div>
                                        <div className="text-xs leading-relaxed text-slate-500">{option.description}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            disabled={!instruction.trim() || isSubmitting}
                            onClick={() => void onSubmit(instruction, mode)}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <GitMerge className="h-4 w-4" />
                            <span>{isSubmitting ? 'Merging...' : 'Merge Branches'}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
