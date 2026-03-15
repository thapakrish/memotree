import { useEffect, useState } from 'react';
import { Clock3, FolderOpen, History, Plus, X } from 'lucide-react';
import { listSessions, loadLastSession, type PersistedSession } from '../lib/sessionPersistence';
import { useGraphStore } from '../store/useGraphStore';

interface SessionsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SessionsModal({ isOpen, onClose }: SessionsModalProps) {
    const [sessions, setSessions] = useState<PersistedSession[]>([]);
    const [lastSessionId, setLastSessionId] = useState<string | null>(null);
    const { createNewSession, loadSessionById, sessionId } = useGraphStore();

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        void Promise.all([listSessions(), loadLastSession()]).then(([allSessions, lastSession]) => {
            setSessions(allSessions);
            setLastSessionId(lastSession?.id ?? null);
        });
    }, [isOpen, sessionId]);

    if (!isOpen) {
        return null;
    }

    const recentSessions = sessions.filter((session) => session.id !== sessionId).slice(0, 12);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800">Sessions</h2>
                        <p className="text-sm text-slate-500">Start fresh or reopen a previous conversation tree.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        title="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid gap-4 p-6 md:grid-cols-2">
                    <button
                        onClick={() => {
                            createNewSession();
                            onClose();
                        }}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                    >
                        <div className="mb-3 flex items-center gap-3">
                            <div className="rounded-xl bg-blue-600 p-2 text-white">
                                <Plus className="h-4 w-4" />
                            </div>
                            <div className="text-sm font-semibold text-slate-800">New Session</div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-500">
                            Create a fresh conversation tree with a new root and isolated history.
                        </p>
                    </button>

                    <button
                        onClick={() => {
                            if (lastSessionId) {
                                void loadSessionById(lastSessionId).then(onClose);
                            }
                        }}
                        disabled={!lastSessionId || lastSessionId === sessionId}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <div className="mb-3 flex items-center gap-3">
                            <div className="rounded-xl bg-emerald-600 p-2 text-white">
                                <History className="h-4 w-4" />
                            </div>
                            <div className="text-sm font-semibold text-slate-800">Resume Last</div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-500">
                            Jump back to the most recently active saved session.
                        </p>
                    </button>
                </div>

                <div className="border-t border-slate-100 px-6 py-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>Open Existing Session</span>
                    </div>

                    {recentSessions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                            No saved sessions besides the current one yet.
                        </div>
                    ) : (
                        <div className="max-h-[360px] space-y-2 overflow-y-auto">
                            {recentSessions.map((session) => (
                                <button
                                    key={session.id}
                                    onClick={() => {
                                        void loadSessionById(session.id).then(onClose);
                                    }}
                                    className="flex w-full items-start justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-blue-300 hover:bg-slate-50"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-slate-800">{session.title}</div>
                                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                                            <Clock3 className="h-3.5 w-3.5" />
                                            <span>{new Date(session.updatedAt).toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div className="ml-4 text-[11px] font-mono text-slate-300">
                                        {session.id.slice(0, 8)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
