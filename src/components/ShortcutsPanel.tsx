import { Command, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronDown, Keyboard } from 'lucide-react';
import { useState } from 'react';

export function ShortcutsPanel() {
    const [isCollapsed, setIsCollapsed] = useState(false);

    if (isCollapsed) {
        return (
            <button 
                onClick={() => setIsCollapsed(false)}
                className="absolute bottom-6 right-6 z-10 flex items-center justify-center p-3 bg-white/90 backdrop-blur-md rounded-full shadow-lg border border-slate-200/60 hover:bg-slate-50 transition-colors group"
                title="Show Keyboard Shortcuts"
            >
                <Keyboard className="w-5 h-5 text-slate-500 group-hover:text-slate-700" />
            </button>
        );
    }

    return (
        <div className="absolute bottom-6 right-6 z-10 w-64 bg-white/90 backdrop-blur-md rounded-xl shadow-lg border border-slate-200/60 overflow-hidden font-sans">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Keyboard Shortcuts</h3>
                <button 
                    onClick={() => setIsCollapsed(true)}
                    className="p-1 rounded hover:bg-slate-200/50 text-slate-400 hover:text-slate-600 transition-colors"
                    title="Hide Panel"
                >
                    <ChevronDown className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="p-2 space-y-0.5">
                
                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Undo (Parent)</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-50 border border-slate-200/50 text-xs font-mono text-slate-400 shadow-sm opacity-50" title="Optional"><Command className="w-3 h-3" /></kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><ArrowUp className="w-3 h-3" /></kbd>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Redo (Child)</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-50 border border-slate-200/50 text-xs font-mono text-slate-400 shadow-sm opacity-50" title="Optional"><Command className="w-3 h-3" /></kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><ArrowDown className="w-3 h-3" /></kbd>
                    </div>
                </div>

                <div className="my-1 border-t border-slate-100 w-full" />

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Prev Branch</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-50 border border-slate-200/50 text-xs font-mono text-slate-400 shadow-sm opacity-50" title="Optional"><Command className="w-3 h-3" /></kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><ArrowLeft className="w-3 h-3" /></kbd>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Next Branch</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-50 border border-slate-200/50 text-xs font-mono text-slate-400 shadow-sm opacity-50" title="Optional"><Command className="w-3 h-3" /></kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><ArrowRight className="w-3 h-3" /></kbd>
                    </div>
                </div>

                <div className="my-1 border-t border-slate-100 w-full" />

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Go to Root</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center h-5 px-1.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-sans font-medium text-slate-500 shadow-sm">Shift</kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-50 border border-slate-200/50 text-xs font-mono text-slate-400 shadow-sm opacity-50" title="Optional"><Command className="w-3 h-3" /></kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><ArrowUp className="w-3 h-3" /></kbd>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Cmd Palette</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><Command className="w-3 h-3" /></kbd>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-[11px] font-sans font-medium text-slate-500 shadow-sm">K</kbd>
                    </div>
                </div>

                <div className="my-1 border-t border-slate-100 w-full" />

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Toggle Select Mode</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-[11px] font-sans font-medium text-slate-500 shadow-sm">V</kbd>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Box Select Nodes</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-[11px] font-sans font-medium text-slate-500 shadow-sm">V</kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center h-5 px-1.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-sans font-medium text-slate-500 shadow-sm">Drag</kbd>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Add to Selection</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center h-5 px-1.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-sans font-medium text-slate-500 shadow-sm">Shift</kbd>
                        <span className="text-slate-300 text-[10px]">or</span>
                        <kbd className="flex items-center justify-center w-5 h-5 rounded bg-slate-100 border border-slate-200 text-xs font-mono text-slate-500 shadow-sm"><Command className="w-3 h-3" /></kbd>
                        <span className="text-slate-300 text-[10px] mx-0.5">+</span>
                        <kbd className="flex items-center justify-center h-5 px-1.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-sans font-medium text-slate-500 shadow-sm">Click</kbd>
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
                    <span>Clear Selection</span>
                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <kbd className="flex items-center justify-center h-5 px-1.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-sans font-medium text-slate-500 shadow-sm">Esc</kbd>
                    </div>
                </div>

            </div>
        </div>
    );
}
