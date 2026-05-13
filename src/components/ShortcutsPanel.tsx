import { Command, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronDown, Keyboard } from 'lucide-react';
import { useState } from 'react';
import { featureFlags } from '../config/featureFlags';

const Kbd = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => (
    <kbd className={`inline-flex items-center justify-center h-5 rounded bg-slate-100 border border-slate-200 text-[10px] font-sans font-medium text-slate-500 shadow-sm ${wide ? 'px-1.5' : 'w-5'}`}>
        {children}
    </kbd>
);

const Or = () => <span className="text-slate-300 text-[10px]">or</span>;
const Plus = () => <span className="text-slate-300 text-[10px] mx-0.5">+</span>;

const Row = ({ label, keys }: { label: string; keys: React.ReactNode }) => (
    <div className="flex items-center justify-between px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors group">
        <span className="text-xs">{label}</span>
        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
            {keys}
        </div>
    </div>
);

const Divider = () => <div className="my-1 border-t border-slate-100 w-full" />;

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

                <Row label="Go to Parent" keys={<><Kbd><ArrowUp className="w-3 h-3" /></Kbd><Or /><Kbd wide>P</Kbd></>} />
                <Row label="Go to Child" keys={<><Kbd><ArrowDown className="w-3 h-3" /></Kbd><Or /><Kbd wide>N</Kbd></>} />
                <Row label="Prev Branch" keys={<><Kbd><ArrowLeft className="w-3 h-3" /></Kbd><Or /><Kbd wide>B</Kbd></>} />
                <Row label="Next Branch" keys={<><Kbd><ArrowRight className="w-3 h-3" /></Kbd><Or /><Kbd wide>F</Kbd></>} />
                <Row label="Go to Root" keys={<><Kbd wide>Shift</Kbd><Plus /><Kbd><ArrowUp className="w-3 h-3" /></Kbd></>} />

                {featureFlags.keyboardPowerTools && (
                    <>
                        <Divider />
                        <Row label="Command Palette" keys={<><Kbd><Command className="w-3 h-3" /></Kbd><Kbd wide>K</Kbd></>} />
                    </>
                )}

                {featureFlags.graphOrganizationTools && (
                    <>
                        <Divider />
                        <Row label="Toggle Select Mode" keys={<Kbd wide>V</Kbd>} />
                        <Row label="Box Select" keys={<><Kbd wide>V</Kbd><Plus /><Kbd wide>Drag</Kbd></>} />
                        <Row label="Add to Selection" keys={<><Kbd wide>Shift</Kbd><Or /><Kbd><Command className="w-3 h-3" /></Kbd><Plus /><Kbd wide>Click</Kbd></>} />
                        <Row label="Clear Selection" keys={<Kbd wide>Esc</Kbd>} />
                    </>
                )}

            </div>
        </div>
    );
}
