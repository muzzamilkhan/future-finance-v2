"use client";

import { useEffect, useState } from "react";
import { pickTopmostVisible } from "./topmostVisibleDay";

/** Height of the fixed compact bar — cards hidden behind it don't count as visible. */
const COMPACT_BAR_HEIGHT = 44;

/**
 * Tracks which day card is at the top of the viewport, keyed by the `yyyy-MM-dd`
 * strings the cards use for their DOM ids (`day-<key>`).
 *
 * Observes the cards themselves rather than listening to scroll: the list is long and
 * an IntersectionObserver only fires when a card crosses the edge. The top inset keeps
 * the answer in sync with what the user can actually read — without it the card sliding
 * under the fixed bar would still be reported as topmost.
 */
export function useTopmostVisibleDay(orderedKeys: readonly string[]): string | null {
  const [key, setKey] = useState<string | null>(null);
  // Re-subscribe when the rendered set of cards changes (e.g. "Load next month").
  const keysId = orderedKeys.join(",");

  useEffect(() => {
    const keys = keysId ? keysId.split(",") : [];
    const visible = new Set<string>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const k = entry.target.id.slice("day-".length);
          if (entry.isIntersecting) visible.add(k);
          else visible.delete(k);
        }
        setKey(pickTopmostVisible(keys, visible));
      },
      { rootMargin: `-${COMPACT_BAR_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );

    for (const k of keys) {
      const el = document.getElementById(`day-${k}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [keysId]);

  return key;
}
