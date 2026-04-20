import type { TimeOfDay, WeatherCondition } from "./weather-types";

export function timeOfDayFor(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

// Tailwind gradient classes per (condition × time-of-day). Tuned for both themes:
// the alpha overlays keep contrast for foreground text in light AND dark mode.
const GRADIENTS: Record<WeatherCondition, Record<TimeOfDay, string>> = {
  clear: {
    dawn:  "from-orange-200/40 via-amber-100/20 to-sky-200/30 dark:from-orange-700/30 dark:via-amber-800/20 dark:to-sky-900/30",
    day:   "from-sky-200/50 via-cyan-100/30 to-blue-200/40 dark:from-sky-800/40 dark:via-cyan-900/20 dark:to-blue-950/40",
    dusk:  "from-orange-300/40 via-pink-200/30 to-purple-300/30 dark:from-orange-800/30 dark:via-pink-900/20 dark:to-purple-950/40",
    night: "from-indigo-200/30 via-slate-100/20 to-blue-200/30 dark:from-indigo-950/50 dark:via-slate-900/30 dark:to-blue-950/40",
  },
  cloudy: {
    dawn:  "from-slate-200/50 via-orange-100/20 to-slate-300/40 dark:from-slate-800/40 dark:via-orange-950/20 dark:to-slate-900/40",
    day:   "from-slate-200/50 via-slate-100/30 to-slate-300/40 dark:from-slate-800/40 dark:via-slate-900/30 dark:to-slate-950/40",
    dusk:  "from-slate-300/40 via-orange-200/20 to-slate-400/30 dark:from-slate-900/40 dark:via-orange-950/20 dark:to-slate-950/40",
    night: "from-slate-300/30 via-slate-200/20 to-slate-400/30 dark:from-slate-900/50 dark:via-slate-950/30 dark:to-slate-950/50",
  },
  fog: {
    dawn:  "from-stone-200/50 via-stone-100/30 to-stone-300/40 dark:from-stone-800/40 dark:via-stone-900/30 dark:to-stone-950/40",
    day:   "from-stone-200/50 via-stone-100/30 to-stone-300/40 dark:from-stone-800/40 dark:via-stone-900/30 dark:to-stone-950/40",
    dusk:  "from-stone-300/40 via-stone-200/20 to-stone-400/30 dark:from-stone-900/40 dark:via-stone-950/30 dark:to-stone-950/40",
    night: "from-stone-300/30 via-stone-200/20 to-stone-400/30 dark:from-stone-900/50 dark:via-stone-950/40 dark:to-stone-950/50",
  },
  rain: {
    dawn:  "from-slate-300/40 via-blue-200/30 to-slate-400/30 dark:from-slate-800/40 dark:via-blue-950/30 dark:to-slate-900/40",
    day:   "from-slate-300/50 via-blue-200/30 to-slate-400/40 dark:from-slate-800/50 dark:via-blue-950/30 dark:to-slate-900/40",
    dusk:  "from-slate-400/40 via-indigo-300/20 to-slate-500/30 dark:from-slate-900/40 dark:via-indigo-950/20 dark:to-slate-950/40",
    night: "from-slate-400/30 via-indigo-200/20 to-slate-500/30 dark:from-slate-900/50 dark:via-indigo-950/30 dark:to-slate-950/50",
  },
  snow: {
    dawn:  "from-sky-100/50 via-slate-50/40 to-sky-200/40 dark:from-sky-900/40 dark:via-slate-800/30 dark:to-sky-950/40",
    day:   "from-sky-100/60 via-white/40 to-sky-200/50 dark:from-sky-900/40 dark:via-slate-800/30 dark:to-sky-950/40",
    dusk:  "from-sky-200/40 via-violet-100/30 to-sky-300/30 dark:from-sky-950/40 dark:via-violet-950/20 dark:to-sky-950/40",
    night: "from-sky-200/30 via-slate-100/20 to-sky-300/30 dark:from-sky-950/50 dark:via-slate-900/30 dark:to-sky-950/50",
  },
  storm: {
    dawn:  "from-slate-400/40 via-violet-300/20 to-slate-500/40 dark:from-slate-800/50 dark:via-violet-950/30 dark:to-slate-950/50",
    day:   "from-slate-400/50 via-violet-300/30 to-slate-500/40 dark:from-slate-800/50 dark:via-violet-950/30 dark:to-slate-950/50",
    dusk:  "from-slate-500/40 via-violet-400/20 to-slate-600/30 dark:from-slate-900/50 dark:via-violet-950/30 dark:to-slate-950/50",
    night: "from-slate-500/30 via-violet-300/20 to-slate-600/40 dark:from-slate-900/60 dark:via-violet-950/40 dark:to-slate-950/60",
  },
};

export function WeatherBackground({
  condition, timeOfDay, className = "",
}: { condition: WeatherCondition; timeOfDay: TimeOfDay; className?: string }) {
  const grad = GRADIENTS[condition][timeOfDay];
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${grad} ${className}`}
      data-testid={`weather-bg-${condition}-${timeOfDay}`}
    />
  );
}
