import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { syncNotifications } from '../platform/sync';
import { useApp } from './AppContext';

/**
 * Work that runs whenever the app comes to the foreground: notification sync
 * and retention, background memory extraction for idle conversations, and the
 * daily-brief fallback (Samsung may delay background tasks).
 */
export function useAppLifecycle() {
  const { rt, bump } = useApp();
  const running = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        await syncNotifications(rt).catch(() => 0);
        const { ensureTodaysBrief } = await import('../platform/briefRunner');
        await ensureTodaysBrief(rt).catch(() => null);
        await rt.engine.refillRoutines().catch(() => 0);
        const { ensureInsights } = await import('../platform/insightsRunner');
        const suggestions = await ensureInsights(rt).catch(() => []);
        const n = await rt.engine.processIdleConversations(activeConversation.id ?? undefined).catch(() => 0);
        const grown = await rt.engine.consolidate().catch(() => null);
        if (n || suggestions.length || grown?.patterns) bump();
        const { runPhotoIndexing } = await import('../platform/photoIndexRunner');
        void runPhotoIndexing(rt);
      } finally {
        running.current = false;
      }
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [rt, bump]);
}

/** The conversation currently open (so extraction waits until it goes quiet). */
export const activeConversation: { id: string | null } = { id: null };
