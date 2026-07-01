"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";

export function CollapsibleTopSection({
  children, compact,
}: {
  children: React.ReactNode;
  compact: React.ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry!.isIntersecting && entry!.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Tapping the compact bar scrolls the nearest scrollable ancestor back to the
  // top, which brings the full top section into view (the observer expands it).
  const scrollToTop = () => {
    let node: HTMLElement | null = barRef.current?.parentElement ?? null;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        node.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      node = node.parentElement;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      {/* Sticky compact bar — mobile only, only when collapsed. Tap scrolls to top. */}
      <div
        ref={barRef}
        className={`sticky top-0 z-20 -mx-4 flex items-center gap-2 border-b bg-background px-4 py-2 md:hidden ${
          collapsed ? "flex" : "hidden"
        }`}
        onClick={scrollToTop}
        role="button"
        tabIndex={0}
        aria-label="Scroll to top"
      >
        <div className="min-w-0 flex-1">{compact}</div>
        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {/* Full top section — always shown; the floating bar overlays on scroll */}
      <div className="block">{children}</div>

      {/* Sentinel just below the top section */}
      <div ref={sentinelRef} aria-hidden className="h-0" />
    </>
  );
}
