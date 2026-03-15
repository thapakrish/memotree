import { useEffect, useRef, useState } from 'react';
import { Search, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, Command, History, Plus } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import { listSessions, type PersistedSession } from '../lib/sessionPersistence';

interface CommandItem {
    id: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    hint?: string;
    action: () => void | Promise<void>;
}

export function CommandPalette() {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [recentSessions, setRecentSessions] = useState<PersistedSession[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const {
        goToParent,
        goToLatestChild,
        nextSibling,
        prevSibling,
        goToRoot,
        createNewSession,
        loadSessionById,
        activeNodeId,
        sessionId,
    } = useGraphStore();

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        void listSessions().then((sessions) => {
            setRecentSessions(sessions.filter((session) => session.id !== sessionId).slice(0, 5));
        });
    }, [isOpen, sessionId]);

    const commands: CommandItem[] = [
        { id: 'new_session', icon: Plus, label: 'New Session', hint: 'Start a fresh conversation tree', action: createNewSession },
        { id: 'undo', icon: ArrowUp, label: 'Go to Parent (Undo)', action: goToParent },
        { id: 'redo', icon: ArrowDown, label: 'Go to Child (Redo)', action: goToLatestChild },
        { id: 'next_branch', icon: ArrowRight, label: 'Next Sibling Branch', action: nextSibling },
        { id: 'prev_branch', icon: ArrowLeft, label: 'Previous Sibling Branch', action: prevSibling },
        { id: 'root', icon: Home, label: 'Go to Root Note', action: goToRoot },
        ...recentSessions.map((session) => ({
            id: `session_${session.id}`,
            icon: History,
            label: `Resume: ${session.title}`,
            hint: new Date(session.updatedAt).toLocaleString(),
            action: async () => {
                await loadSessionById(session.id);
            },
        })),
    ];

    const filteredCommands = commands.filter((cmd) =>
        `${cmd.label} ${cmd.hint ?? ''}`.toLowerCase().includes(search.toLowerCase()),
    );

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen((open) => {
                    if (!open) {
                        setSearch('');
                        setSelectedIndex(0);
                    }
                    return !open;
                });
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleNavigation = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((index) => Math.min(index + 1, filteredCommands.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((index) => Math.max(index - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const selected = filteredCommands[selectedIndex];
                if (selected) {
                    void Promise.resolve(selected.action()).finally(() => {
                        setIsOpen(false);
                    });
                }
            }
        };

        window.addEventListener('keydown', handleNavigation, true);
        return () => window.removeEventListener('keydown', handleNavigation, true);
    }, [filteredCommands, isOpen, selectedIndex]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-slate-900/20 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
            <div
                className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center px-4 py-3 border-b border-slate-100">
                    <Search className="w-5 h-5 text-slate-400 mr-3" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent border-none outline-none text-slate-800 placeholder:text-slate-400 text-lg"
                        placeholder="Type a command or search..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setSelectedIndex(0);
                        }}
                    />
                    <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">
                        <Command className="w-3 h-3" />
                        <span>K</span>
                    </div>
                </div>

                <div className="max-h-[360px] overflow-y-auto p-2">
                    {filteredCommands.length === 0 ? (
                        <div className="px-4 py-8 text-center text-slate-500">
                            No commands found.
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredCommands.map((cmd, index) => (
                                <button
                                    key={cmd.id}
                                    onClick={() => {
                                        void Promise.resolve(cmd.action()).finally(() => {
                                            setIsOpen(false);
                                        });
                                    }}
                                    className={`w-full flex items-center px-4 py-3 rounded-lg text-left transition-colors ${
                                        index === selectedIndex
                                            ? 'bg-blue-600 text-white'
                                            : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                                >
                                    <cmd.icon className={`w-4 h-4 mr-3 ${index === selectedIndex ? 'text-blue-200' : 'text-slate-400'}`} />
                                    <div className="min-w-0">
                                        <div>{cmd.label}</div>
                                        {cmd.hint && (
                                            <div className={`text-xs truncate ${index === selectedIndex ? 'text-blue-100' : 'text-slate-400'}`}>
                                                {cmd.hint}
                                            </div>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {!activeNodeId && (
                    <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs text-amber-600 font-medium">Tree navigation commands need an active conversation. Session commands work anytime.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
