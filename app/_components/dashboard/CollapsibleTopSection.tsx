"use client";

import { useEffect, useRef, useState } from "react";

export function CollapsibleTopSection({
  children, compact,
}: {
  children: React.ReactNode;
  compact: React.ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
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

  return (
    <>
      {/* Sticky compact bar — mobile only, only when collapsed */}
      <div
        className={`sticky top-0 z-20 -mx-4 border-b bg-background px-4 py-2 sm:hidden ${
          collapsed ? "block" : "hidden"
        }`}
        onClick={() => setCollapsed(false)}
        role="button"
        tabIndex={0}
      >
        {compact}
      </div>

      {/* Full top section — collapses on mobile, always shown on desktop */}
      <div className={collapsed ? "hidden sm:block" : "block"}>{children}</div>

      {/* Sentinel just below the top section */}
      <div ref={sentinelRef} aria-hidden className="h-0" />
    </>
  );
}
