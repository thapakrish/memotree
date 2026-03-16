import { GitBranch, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { ImportedConversationEnvelope, StructureSuggestion } from '../store/types';

interface ImportSuggestionsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ImportSuggestionsDialogProps {
    onClose: () => void;
    importEnvelope: ImportedConversationEnvelope;
    previewImportEnvelope: ImportedConversationEnvelope | null;
    commitImportSuggestions: (suggestions: StructureSuggestion[]) => number;
    previewImportSuggestions: (suggestions: StructureSuggestion[]) => void;
    clearImportPreview: () => void;
}

function kindLabel(kind: string) {
    switch (kind) {
        case 'reset':
            return 'Reset';
        case 'detour_span':
            return 'Detour';
        case 'resume_link':
            return 'Resume';
        case 'branch_start':
            return 'Branch Start';
        default:
            return kind;
    }
}

function ImportSuggestionsDialog({
    onClose,
    importEnvelope,
    previewImportEnvelope,
    commitImportSuggestions,
    previewImportSuggestions,
    clearImportPreview,
}: ImportSuggestionsDialogProps) {
    const [draftSuggestions, setDraftSuggestions] = useState<StructureSuggestion[]>(
        previewImportEnvelope?.suggestions ?? importEnvelope.suggestions ?? [],
    );

    const suggestions = draftSuggestions;
    const pendingCount = suggestions.filter((suggestion) => suggestion.status !== 'accepted' && suggestion.status !== 'rejected').length;
    const acceptedCount = suggestions.filter((suggestion) => suggestion.status === 'accepted').length;
    const hasPreview = Boolean(previewImportEnvelope);
    const hasDraftChanges = useMemo(() => {
        const committed = importEnvelope.suggestions ?? [];
        return JSON.stringify(committed) !== JSON.stringify(draftSuggestions);
    }, [draftSuggestions, importEnvelope]);

    const updateDraftSuggestionStatus = (suggestionId: string, status: 'accepted' | 'rejected' | 'pending') => {
        setDraftSuggestions((currentSuggestions) => currentSuggestions.map((suggestion) =>
            suggestion.id === suggestionId
                ? { ...suggestion, status }
                : suggestion,
        ));
    };

    const acceptHighConfidenceDraft = () => {
        setDraftSuggestions((currentSuggestions) => currentSuggestions.map((suggestion) =>
            suggestion.confidence === 'high'
                ? { ...suggestion, status: 'accepted' as const }
                : suggestion,
        ));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={() => {
            clearImportPreview();
            onClose();
        }}>
            <div
                className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Import Suggestions</h2>
                        <p className="text-sm text-slate-500">Review the deterministic branch and detour suggestions found during import.</p>
                    </div>
                    <button
                        onClick={() => {
                            clearImportPreview();
                            onClose();
                        }}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        title="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div className="text-sm text-slate-600">
                        {suggestions.length} suggestions total, {acceptedCount} accepted, {pendingCount} still pending review.
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={acceptHighConfidenceDraft}
                            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100"
                        >
                            <Sparkles className="h-4 w-4" />
                            <span>Accept High-Confidence</span>
                        </button>
                        <button
                            onClick={() => previewImportSuggestions(draftSuggestions)}
                            disabled={!hasDraftChanges && !hasPreview}
                            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <GitBranch className="h-4 w-4" />
                            <span>{hasPreview ? 'Refresh Preview' : 'Preview Graph'}</span>
                        </button>
                        <button
                            onClick={() => {
                                commitImportSuggestions(draftSuggestions);
                                onClose();
                            }}
                            disabled={acceptedCount === 0}
                            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <GitBranch className="h-4 w-4" />
                            <span>Apply Accepted</span>
                        </button>
                    </div>
                </div>

                <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6 py-5">
                    {hasPreview && (
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                            Preview mode is active in the graph. Apply to commit, or close this modal to discard the preview.
                        </div>
                    )}
                    {suggestions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                            No deterministic structure suggestions were found for this import.
                        </div>
                    ) : (
                        suggestions.map((suggestion) => (
                            <div key={suggestion.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <GitBranch className="h-4 w-4 text-violet-600" />
                                            <span className="text-sm font-semibold text-slate-800">{kindLabel(suggestion.kind)}</span>
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                                suggestion.confidence === 'high'
                                                    ? 'bg-emerald-50 text-emerald-700'
                                                    : suggestion.confidence === 'medium'
                                                        ? 'bg-amber-50 text-amber-700'
                                                        : 'bg-slate-100 text-slate-600'
                                            }`}>
                                                {suggestion.confidence}
                                            </span>
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                                suggestion.status === 'accepted'
                                                    ? 'bg-blue-50 text-blue-700'
                                                    : suggestion.status === 'rejected'
                                                        ? 'bg-rose-50 text-rose-700'
                                                        : 'bg-slate-100 text-slate-600'
                                            }`}>
                                                {suggestion.status ?? 'pending'}
                                            </span>
                                        </div>
                                        <div className="mt-2 text-sm leading-relaxed text-slate-600">
                                            {suggestion.rationale}
                                        </div>
                                        <div className="mt-2 text-xs text-slate-400">
                                            Turns: {suggestion.turnIds.join(', ')}
                                            {suggestion.anchorTurnId ? ` | Anchor: ${suggestion.anchorTurnId}` : ''}
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            onClick={() => updateDraftSuggestionStatus(suggestion.id, 'accepted')}
                                            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                                        >
                                            Accept
                                        </button>
                                        <button
                                            onClick={() => updateDraftSuggestionStatus(suggestion.id, 'rejected')}
                                            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                                        >
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => updateDraftSuggestionStatus(suggestion.id, 'pending')}
                                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export function ImportSuggestionsModal({ isOpen, onClose }: ImportSuggestionsModalProps) {
    const {
        importEnvelope,
        previewImportEnvelope,
        commitImportSuggestions,
        previewImportSuggestions,
        clearImportPreview,
    } = useGraphStore();

    if (!isOpen || !importEnvelope) {
        return null;
    }

    return (
        <ImportSuggestionsDialog
            onClose={onClose}
            importEnvelope={importEnvelope}
            previewImportEnvelope={previewImportEnvelope ?? null}
            commitImportSuggestions={commitImportSuggestions}
            previewImportSuggestions={previewImportSuggestions}
            clearImportPreview={clearImportPreview}
        />
    );
}
