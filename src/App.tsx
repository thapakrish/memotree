import { ChatView } from './components/ChatView';
import { useGraphStore } from './store/useGraphStore';
import { lazy, Suspense, useEffect, useState } from 'react';
import { featureFlags } from './config/featureFlags';
import { ImageIcon, MessageSquare } from 'lucide-react';

type MobileTab = 'chat' | 'canvas';

const GraphView = lazy(() => import('./components/GraphView').then((module) => ({ default: module.GraphView })));
const ImageCanvas = lazy(() => import('./components/ImageCanvas').then((module) => ({ default: module.ImageCanvas })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then((module) => ({ default: module.CommandPalette })));

function MobileTabBar({ tab, onChange }: { tab: MobileTab; onChange: (t: MobileTab) => void }) {
  return (
    <div className="flex h-14 shrink-0 border-t border-slate-200 bg-white md:hidden">
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
        onClick={() => onChange('canvas')}
        className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
          tab === 'canvas' ? 'text-blue-600' : 'text-slate-400'
        }`}
      >
        <ImageIcon className="h-5 w-5" />
        Canvas
      </button>
    </div>
  );
}

function CanvasSurface() {
  return (
    <Suspense fallback={<div className="h-full w-full bg-slate-50" />}>
      {featureFlags.advancedGraphTools ? <GraphView /> : <ImageCanvas />}
    </Suspense>
  );
}

function shouldIgnoreGlobalShortcut(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return true;
  }

  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }

  return Boolean(target.closest([
    '[role="dialog"]',
    'input',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[contenteditable="true"]',
    '[role="button"]',
  ].join(',')));
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
      if (shouldIgnoreGlobalShortcut(e)) {
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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white font-sans md:h-screen md:flex-row md:bg-slate-100">
        <div
          className={`min-h-0 flex-1 overflow-hidden md:h-full md:w-[450px] md:flex-none md:shadow-xl ${
            mobileTab === 'chat' ? 'block' : 'hidden'
          } md:block`}
          style={{ zIndex: 10 }}
        >
          <ChatView />
        </div>
        <div
          className={`relative min-h-0 flex-1 overflow-hidden bg-slate-50 ${
            mobileTab === 'canvas' ? 'block' : 'hidden'
          } md:block`}
        >
          <CanvasSurface />
        </div>
        <MobileTabBar tab={mobileTab} onChange={setMobileTab} />
        {featureFlags.keyboardPowerTools && (
          <Suspense fallback={null}>
            <CommandPalette />
          </Suspense>
        )}
    </div>
  );
}

export default App;
