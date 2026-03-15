import { ChatView } from './components/ChatView';
import { GraphView } from './components/GraphView';
import { ReactFlowProvider } from '@xyflow/react';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsPanel } from './components/ShortcutsPanel';
import { useGraphStore } from './store/useGraphStore';
import { useEffect } from 'react';

function App() {
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
      // Allow default text navigation if typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return; 
      }

      // If we made it past the input check, we assume the user is "on the canvas" (or at least not in an input).
      // We will allow BOTH 'Cmd + Arrow' AND just plain 'Arrow' for tree navigation to reduce friction.
      // E.g. someone might prefer just tapping 'Up' to undo.

      // e.g. cmdOrCtrl check removed since plain arrow keys are now permitted

      switch (e.key) {
        case 'ArrowUp':
        case 'p':
          // C-p / UP
          e.preventDefault();
          if (e.shiftKey && e.key === 'ArrowUp') {
            goToRoot();
          } else {
            goToParent();
          }
          break;
        case 'ArrowDown':
        case 'n':
          // C-n / DOWN
          e.preventDefault();
          goToLatestChild();
          break;
        case 'ArrowLeft':
        case 'b':
          // C-b / LEFT
          e.preventDefault();
          prevSibling();
          break;
        case 'ArrowRight':
        case 'f':
          // C-f / RIGHT
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
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900 font-sans">
      {/* Pane A: Chat View (Fixed Width Sidebar) */}
      <div className="w-[450px] min-w-[350px] max-w-[600px] h-full z-10 shadow-xl">
        <ChatView />
      </div>

      {/* Pane B: Graph View (Flexible Canvas) */}
      <div className="flex-1 h-full z-0 relative">
        <ReactFlowProvider>
          <GraphView />
          <ShortcutsPanel />
        </ReactFlowProvider>
      </div>
      
      {/* Global Command Palette */}
      <CommandPalette />
    </div>
  );
}

export default App;
