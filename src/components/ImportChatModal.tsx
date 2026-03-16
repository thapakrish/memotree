import { useMemo, useState } from 'react';
import { Download, Link2, X } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import type { ImportSourcePlatform } from '../store/types';
import { normalizeTranscript } from '../lib/import/normalizeTranscript';
import { inferStructureRules } from '../lib/import/inferStructureRules';
import { detectSharedImportUrl, fetchSharedTranscriptFromUrl } from '../lib/import/sharedUrl';
import { SHARED_IMPORT_ENDPOINT } from '../lib/import/sharedImportApi';

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
    const [importMode, setImportMode] = useState<'transcript' | 'url'>('transcript');
    const [sourcePlatform, setSourcePlatform] = useState<ImportSourcePlatform>('chatgpt');
    const [text, setText] = useState('');
    const [sharedUrl, setSharedUrl] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [urlImportError, setUrlImportError] = useState<string | null>(null);
    const { importLinearTranscript } = useGraphStore();

    const normalized = useMemo(() => normalizeTranscript({
        sourcePlatform,
        text,
        formatHint: 'auto',
    }), [sourcePlatform, text]);
    const suggestions = useMemo(() => inferStructureRules(normalized.turns), [normalized.turns]);
    const highConfidenceSuggestions = suggestions.filter((suggestion) => suggestion.confidence === 'high');
    const sharedUrlDetection = useMemo(() => detectSharedImportUrl(sharedUrl), [sharedUrl]);

    if (!isOpen) {
        return null;
    }

    const handleImport = async () => {
        setUrlImportError(null);
        setIsImporting(true);

        try {
            if (importMode === 'url') {
                if (!sharedUrlDetection?.isSupported) {
                    setUrlImportError('Paste a supported public shared URL from ChatGPT, Gemini, or Claude.');
                    return;
                }

                const fetched = await fetchSharedTranscriptFromUrl(sharedUrlDetection.normalizedUrl);
                const importedNodeId = importLinearTranscript({
                    sourcePlatform: fetched.sourcePlatform,
                    turns: fetched.turns,
                    sourceConversationId: fetched.sourceConversationId,
                    parserConfidence: fetched.parserConfidence,
                    importWarnings: fetched.warnings,
                });

                if (importedNodeId) {
                    setText('');
                    setSharedUrl('');
                    onClose();
                }
                return;
            }

            const importedNodeId = importLinearTranscript({
                sourcePlatform,
                turns: normalized.turns,
            });

            if (importedNodeId) {
                setText('');
                setSharedUrl('');
                onClose();
            }
        } catch (error) {
            setUrlImportError(error instanceof Error ? error.message : 'Shared URL import failed.');
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
                        <p className="text-sm text-slate-500">Import a pasted transcript now, or prepare a shared-link import for ChatGPT, Gemini, and Claude.</p>
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
                                Import Type
                            </label>
                            <div className="space-y-2">
                                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-blue-300 hover:bg-slate-50">
                                    <input
                                        type="radio"
                                        name="import-mode"
                                        checked={importMode === 'transcript'}
                                        onChange={() => setImportMode('transcript')}
                                    />
                                    <span className="text-sm font-medium text-slate-700">Paste Transcript</span>
                                </label>
                                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-blue-300 hover:bg-slate-50">
                                    <input
                                        type="radio"
                                        name="import-mode"
                                        checked={importMode === 'url'}
                                        onChange={() => setImportMode('url')}
                                    />
                                    <span className="text-sm font-medium text-slate-700">Shared URL</span>
                                </label>
                            </div>
                        </div>

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
                            {importMode === 'transcript' ? (
                                <>
                                    <div className="mt-2 text-sm text-slate-700">{normalized.turns.length} turns detected</div>
                                    <div className="mt-1 text-sm text-slate-700">{suggestions.length} structure suggestions</div>
                                    <div className="mt-1 text-xs text-slate-500">{highConfidenceSuggestions.length} high-confidence suggestions will be attached for later review.</div>
                                </>
                            ) : (
                                <>
                                    <div className="mt-2 text-sm text-slate-700">
                                        {sharedUrlDetection ? sharedUrlDetection.label : 'Paste a share URL to detect provider'}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        {sharedUrlDetection?.isSupported
                                            ? 'Provider detected. The local server adapter will try a provider-aware parser, then fall back to generic extraction.'
                                            : 'Only public share links from known providers will be supported here.'}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div>
                        {importMode === 'transcript' ? (
                            <>
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
                            </>
                        ) : (
                            <>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                    Shared URL
                                </label>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                                        <Link2 className="h-4 w-4 text-slate-400" />
                                        <input
                                            value={sharedUrl}
                                            onChange={(event) => setSharedUrl(event.target.value)}
                                            placeholder="https://chatgpt.com/share/... or https://g.co/gemini/share/..."
                                            className="w-full bg-transparent text-sm text-slate-700 outline-none"
                                        />
                                    </div>
                                    <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm leading-relaxed text-slate-600">
                                        Shared-link import will call a server-side fetch adapter at <span className="font-mono text-xs">{SHARED_IMPORT_ENDPOINT}</span> and feed the returned transcript into the same import pipeline.
                                    </div>
                                    {urlImportError && (
                                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-700">
                                            {urlImportError}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
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
                        disabled={isImporting || (importMode === 'transcript' ? normalized.turns.length === 0 : !sharedUrlDetection?.isSupported)}
                        onClick={() => void handleImport()}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {importMode === 'transcript' ? <Download className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                        <span>
                            {isImporting
                                ? 'Importing...'
                                : importMode === 'transcript'
                                    ? 'Import Chat'
                                    : 'Import From URL'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
