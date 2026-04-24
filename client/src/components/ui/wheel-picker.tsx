import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const ITEM_HEIGHT = 36;
const VISIBLE = 5;

export type WheelOption = { value: string | number; label: string };

interface Props {
  options: WheelOption[];
  value: string | number;
  onChange: (v: any) => void;
  className?: string;
  width?: string;
  align?: "center" | "left" | "right";
  "data-testid"?: string;
}

/**
 * Touch-friendly iOS-style scrolling drum picker.
 * Uses native scroll snap so it feels right on iOS, Android and desktop trackpads.
 */
export function WheelPicker({
  options,
  value,
  onChange,
  className,
  width = "5.5rem",
  align = "center",
  "data-testid": testId,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUserScrolling = useRef(false);

  const idx = useMemo(() => {
    const i = options.findIndex(o => String(o.value) === String(value));
    return i >= 0 ? i : 0;
  }, [options, value]);

  // External value changes scroll the wheel into position.
  useEffect(() => {
    if (!ref.current) return;
    const target = idx * ITEM_HEIGHT;
    if (Math.abs(ref.current.scrollTop - target) > 1) {
      ref.current.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [idx]);

  const handleScroll = () => {
    if (!ref.current) return;
    isUserScrolling.current = true;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (!ref.current) return;
      const newIdx = Math.round(ref.current.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(options.length - 1, newIdx));
      const next = options[clamped];
      isUserScrolling.current = false;
      if (next && String(next.value) !== String(value)) onChange(next.value);
    }, 120);
  };

  const padPx = ITEM_HEIGHT * Math.floor(VISIBLE / 2);
  const containerHeight = ITEM_HEIGHT * VISIBLE;

  return (
    <div
      className={cn("relative select-none", className)}
      style={{ width, height: containerHeight }}
      data-testid={testId}
    >
      {/* center indicator */}
      <div
        className="pointer-events-none absolute left-1 right-1 top-1/2 -translate-y-1/2 rounded-md bg-primary/10 ring-1 ring-primary/40"
        style={{ height: ITEM_HEIGHT }}
      />
      {/* fade top/bottom */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent z-10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent z-10" />

      <div
        ref={ref}
        onScroll={handleScroll}
        className="h-full overflow-y-scroll snap-y snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div style={{ height: padPx }} />
        {options.map((opt, i) => (
          <button
            type="button"
            key={`${opt.value}-${i}`}
            onClick={() => {
              if (!ref.current) return;
              ref.current.scrollTo({ top: i * ITEM_HEIGHT, behavior: "smooth" });
              onChange(opt.value);
            }}
            className={cn(
              "snap-center w-full flex items-center px-2 transition-all",
              align === "center" && "justify-center",
              align === "left" && "justify-start",
              align === "right" && "justify-end",
              i === idx ? "text-foreground font-semibold text-base" : "text-muted-foreground/70 text-sm"
            )}
            style={{ height: ITEM_HEIGHT, scrollSnapAlign: "center" }}
            data-testid={`${testId}-option-${opt.value}`}
          >
            {opt.label}
          </button>
        ))}
        <div style={{ height: padPx }} />
      </div>
    </div>
  );
}

interface GroupProps {
  children: React.ReactNode;
  className?: string;
}
export function WheelGroup({ children, className }: GroupProps) {
  return (
    <div className={cn("flex items-center gap-1.5 rounded-xl border border-border/60 bg-secondary/20 p-1.5", className)}>
      {children}
    </div>
  );
}
