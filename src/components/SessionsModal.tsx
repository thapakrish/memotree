import { useEffect, useRef, useState } from 'react';
import { Clock3, Download, FolderOpen, History, Import, Plus, Upload, X } from 'lucide-react';
import { deleteSession, exportSessionToFile, importSessionFromJson, listSessions, loadLastSession, renameSessionTitle, type PersistedSession } from '../lib/sessionPersistence';
import { useGraphStore } from '../store/useGraphStore';
import { ImportChatModal } from './ImportChatModal';

interface SessionsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SessionsModal({ isOpen, onClose }: SessionsModalProps) {
    const [sessions, setSessions] = useState<PersistedSession[]>([]);
    const [lastSessionId, setLastSessionId] = useState<string | null>(null);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [isImportingFile, setIsImportingFile] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { createNewSession, loadSessionById, loadSessionFromData, sessionId, setSessionTitle } = useGraphStore();

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        void Promise.all([listSessions(), loadLastSession()]).then(([allSessions, lastSession]) => {
            setSessions(allSessions);
            setLastSessionId(lastSession?.id ?? null);
        });
    }, [isOpen, sessionId]);

    const refreshSessions = () => {
        void Promise.all([listSessions(), loadLastSession()]).then(([allSessions, lastSession]) => {
            setSessions(allSessions);
            setLastSessionId(lastSession?.id ?? null);
        });
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportError(null);
        setIsImportingFile(true);
        try {
            const imported = await importSessionFromJson(file);
            await loadSessionFromData(imported);
            refreshSessions();
            onClose();
        } catch (err) {
            setImportError(err instanceof Error ? err.message : 'Import failed.');
        } finally {
            setIsImportingFile(false);
            e.target.value = '';
        }
    };

    const handleDeleteSession = async (sessionId: string) => {
        await deleteSession(sessionId);
        refreshSessions();
    };

    const startEditingSessionTitle = (session: PersistedSession) => {
        setImportError(null);
        setEditingSessionId(session.id);
        setEditingTitle(session.title);
    };

    const stopEditingSessionTitle = () => {
        setEditingSessionId(null);
        setEditingTitle('');
    };

    const commitSessionTitle = async () => {
        if (!editingSessionId) return;
        const nextTitle = editingTitle.trim();
        if (!nextTitle) {
            stopEditingSessionTitle();
            return;
        }

        try {
            if (editingSessionId === sessionId) {
                setSessionTitle(nextTitle);
                setSessions((previous) => previous.map((session) =>
                    session.id === editingSessionId ? { ...session, title: nextTitle } : session,
                ));
            } else {
                await renameSessionTitle(editingSessionId, nextTitle);
                setSessions((previous) => previous.map((session) =>
                    session.id === editingSessionId ? { ...session, title: nextTitle } : session,
                ));
            }
            refreshSessions();
        } catch (err) {
            setImportError(err instanceof Error ? err.message : 'Rename failed.');
        } finally {
            stopEditingSessionTitle();
        }
    };

    if (!isOpen) {
        return null;
    }

    const recentSessions = sessions.filter((session) => session.id !== sessionId).slice(0, 12);
    const currentSession = sessions.find((s) => s.id === sessionId);

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
                        <p className="text-sm text-slate-500">Start fresh or reopen a previous conversation tree. Double-click a title to rename it.</p>
                        {currentSession && (
                            editingSessionId === currentSession.id ? (
                                <input
                                    autoFocus
                                    value={editingTitle}
                                    onChange={(event) => setEditingTitle(event.target.value)}
                                    onBlur={() => void commitSessionTitle()}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            void commitSessionTitle();
                                        } else if (event.key === 'Escape') {
                                            stopEditingSessionTitle();
                                        }
                                    }}
                                    className="mt-2 rounded-md border border-blue-200 bg-white px-2 py-1 text-sm font-medium text-slate-700 outline-none focus:border-blue-400"
                                />
                            ) : (
                                <button
                                    onDoubleClick={() => startEditingSessionTitle(currentSession)}
                                    className="mt-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                                    title="Double-click to rename current session"
                                >
                                    {currentSession.title}
                                </button>
                            )
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {currentSession && (
                            <button
                                onClick={() => exportSessionToFile(currentSession)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                                title="Export current session to JSON file"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Export current
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                            title="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="grid gap-4 p-6 md:grid-cols-3">
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

                    <button
                        onClick={() => setIsImportOpen(true)}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50"
                    >
                        <div className="mb-3 flex items-center gap-3">
                            <div className="rounded-xl bg-violet-600 p-2 text-white">
                                <Import className="h-4 w-4" />
                            </div>
                            <div className="text-sm font-semibold text-slate-800">Import Chat</div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-500">
                            Paste a linear transcript from another chat app and turn it into a MemoTree session.
                        </p>
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImportingFile}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition-colors hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50"
                    >
                        <div className="mb-3 flex items-center gap-3">
                            <div className="rounded-xl bg-sky-600 p-2 text-white">
                                <Upload className="h-4 w-4" />
                            </div>
                            <div className="text-sm font-semibold text-slate-800">
                                {isImportingFile ? 'Importing…' : 'Import Session File'}
                            </div>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-500">
                            Restore a previously exported MemoTree session JSON, including all attachments.
                        </p>
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(e) => void handleImportFile(e)}
                    />
                </div>

                {importError && (
                    <div className="mx-6 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {importError}
                    </div>
                )}

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
                                <div
                                    key={session.id}
                                    className="group flex w-full items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:border-blue-200 hover:bg-slate-50"
                                >
                                    <button
                                        onClick={() => void loadSessionById(session.id).then(onClose)}
                                        className="min-w-0 flex-1 text-left"
                                    >
                                        {editingSessionId === session.id ? (
                                            <input
                                                autoFocus
                                                value={editingTitle}
                                                onChange={(event) => setEditingTitle(event.target.value)}
                                                onBlur={() => void commitSessionTitle()}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        void commitSessionTitle();
                                                    } else if (event.key === 'Escape') {
                                                        stopEditingSessionTitle();
                                                    }
                                                }}
                                                className="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-blue-400"
                                            />
                                        ) : (
                                            <div
                                                onDoubleClick={() => startEditingSessionTitle(session)}
                                                className="truncate text-sm font-medium text-slate-800"
                                                title="Double-click to rename"
                                            >
                                                {session.title}
                                            </div>
                                        )}
                                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                                            <Clock3 className="h-3.5 w-3.5" />
                                            <span>{new Date(session.updatedAt).toLocaleString()}</span>
                                            <span className="font-mono">{session.id.slice(0, 8)}</span>
                                        </div>
                                    </button>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button
                                            onClick={() => exportSessionToFile(session)}
                                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
                                            title="Export session to file"
                                        >
                                            <Download className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            onClick={() => void handleDeleteSession(session.id)}
                                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                                            title="Delete session"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <ImportChatModal
                isOpen={isImportOpen}
                onClose={() => {
                    setIsImportOpen(false);
                    onClose();
                }}
            />
        </div>
    );
}
