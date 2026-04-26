import { ChatView } from './components/ChatView';
import { GraphView } from './components/GraphView';
import { ReactFlowProvider } from '@xyflow/react';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsPanel } from './components/ShortcutsPanel';
import { useGraphStore } from './store/useGraphStore';
import { useEffect, useState } from 'react';
import { featureFlags } from './config/featureFlags';
import { MessageSquare, GitBranch } from 'lucide-react';

type MobileTab = 'chat' | 'tree';

function MobileTabBar({ tab, onChange }: { tab: MobileTab; onChange: (t: MobileTab) => void }) {
  return (
    <div className="flex h-14 shrink-0 border-t border-slate-200 bg-white">
      <button
        onClick={() => onChange('chat')}
        className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
          tab === 'chat' ? 'text-blue-600' : 'text-slate-400'
        }`}
      >
        <MessageSquare className="h-5 w-5" />
        Chat
      </button>
      <button
        onClick={() => onChange('tree')}
        className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
          tab === 'tree' ? 'text-blue-600' : 'text-slate-400'
        }`}
      >
        <GitBranch className="h-5 w-5" />
        Tree
      </button>
    </div>
  );
}

function App() {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const {
    isHydrated,
    hydrateSession,
    goToParent,
    goToLatestChild,
    nextSibling,
    prevSibling,
    goToRoot,
  } = useGraphStore();

  useEffect(() => {
    void hydrateSession();
  }, [hydrateSession]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return;
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'p':
          e.preventDefault();
          if (e.shiftKey && e.key === 'ArrowUp') {
            goToRoot();
          } else {
            goToParent();
          }
          break;
        case 'ArrowDown':
        case 'n':
          e.preventDefault();
          goToLatestChild();
          break;
        case 'ArrowLeft':
        case 'b':
          e.preventDefault();
          prevSibling();
          break;
        case 'ArrowRight':
        case 'f':
          e.preventDefault();
          nextSibling();
          break;
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [goToParent, goToLatestChild, nextSibling, prevSibling, goToRoot, isHydrated]);

  if (!isHydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-900 text-slate-200">
        Restoring MemoTree session...
      </div>
    );
  }

  return (
    <>
      {/* ── Mobile layout (< md) ── */}
      <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white font-sans md:hidden">
        <div className={`min-h-0 flex-1 overflow-hidden ${mobileTab === 'chat' ? 'block' : 'hidden'}`}>
          <ChatView />
        </div>
        <div className={`min-h-0 flex-1 overflow-hidden ${mobileTab === 'tree' ? 'block' : 'hidden'}`}>
          <ReactFlowProvider>
            <GraphView />
          </ReactFlowProvider>
        </div>
        <MobileTabBar tab={mobileTab} onChange={setMobileTab} />
      </div>

      {/* ── Desktop layout (≥ md) ── */}
      <div className="hidden h-screen w-screen overflow-hidden bg-slate-900 font-sans md:flex">
        {/* Pane A: Chat */}
        <div className="h-full w-[450px] shrink-0 overflow-hidden shadow-xl" style={{ zIndex: 10 }}>
          <ChatView />
        </div>
        {/* Pane B: Graph */}
        <div className="relative h-full flex-1">
          <ReactFlowProvider>
            <GraphView />
            <ShortcutsPanel />
          </ReactFlowProvider>
        </div>
        {featureFlags.keyboardPowerTools && <CommandPalette />}
      </div>
    </>
  );
}

export default App;
