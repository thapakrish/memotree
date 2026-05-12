import { useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import type { ImportSourcePlatform } from '../store/types';
import { normalizeTranscript } from '../lib/import/normalizeTranscript';
import { inferStructureRules } from '../lib/import/inferStructureRules';
import { featureFlags } from '../config/featureFlags';

interface ImportChatModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const sourceOptions: Array<{ value: ImportSourcePlatform; label: string }> = [
    { value: 'chatgpt', label: 'ChatGPT' },
    { value: 'claude', label: 'Claude' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'other', label: 'Other' },
];

export function ImportChatModal({ isOpen, onClose }: ImportChatModalProps) {
    const [sourcePlatform, setSourcePlatform] = useState<ImportSourcePlatform>('chatgpt');
    const [text, setText] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const { importLinearTranscript } = useGraphStore();

    const normalized = useMemo(() => normalizeTranscript({
        sourcePlatform,
        text,
        formatHint: 'auto',
    }), [sourcePlatform, text]);
    const suggestions = useMemo(
        () => featureFlags.importInference ? inferStructureRules(normalized.turns) : [],
        [normalized.turns],
    );
    const highConfidenceSuggestions = suggestions.filter((suggestion) => suggestion.confidence === 'high');

    if (!isOpen) {
        return null;
    }

    const handleImport = async () => {
        setIsImporting(true);

        try {
            const importedNodeId = importLinearTranscript({
                sourcePlatform,
                turns: normalized.turns,
            });

            if (importedNodeId) {
                setText('');
                onClose();
            }
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Import Chat</h2>
                        <p className="text-sm text-slate-500">Paste a visible transcript from ChatGPT, Claude, Gemini, or another chat tool.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        title="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid gap-6 px-6 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="space-y-5">
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                Source
                            </label>
                            <div className="space-y-2">
                                {sourceOptions.map((option) => (
                                    <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-blue-300 hover:bg-slate-50">
                                        <input
                                            type="radio"
                                            name="import-source"
                                            checked={sourcePlatform === option.value}
                                            onChange={() => setSourcePlatform(option.value)}
                                        />
                                        <span className="text-sm font-medium text-slate-700">{option.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                            This first version imports only the visible transcript. Hidden vendor memory or project context is not reconstructed.
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Preview</div>
                            <div className="mt-2 text-sm text-slate-700">{normalized.turns.length} turns detected</div>
                            {featureFlags.importInference && (
                                <>
                                    <div className="mt-1 text-sm text-slate-700">{suggestions.length} structure suggestions</div>
                                    <div className="mt-1 text-xs text-slate-500">{highConfidenceSuggestions.length} high-confidence suggestions will be attached for later review.</div>
                                </>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Transcript
                        </label>
                        <textarea
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            rows={18}
                            placeholder={'User: Help me plan a trip\nAssistant: Sure, where are you going?\nUser: Actually switch to a weekend trip instead'}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none transition-colors focus:border-blue-400 focus:bg-white"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
                    <button
                        onClick={onClose}
                        disabled={isImporting}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                    >
                        Cancel
                    </button>
                    <button
                        disabled={isImporting || normalized.turns.length === 0}
                        onClick={() => void handleImport()}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Download className="h-4 w-4" />
                        <span>{isImporting ? 'Importing...' : 'Import Chat'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
