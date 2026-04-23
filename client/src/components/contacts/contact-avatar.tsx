import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<Size, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-20 w-20 text-2xl",
};

const COLORS = [
  "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  "bg-rose-500/20 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
  "bg-orange-500/20 text-orange-700 dark:text-orange-300",
];

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name?: string | null) {
  const s = String(name || "?");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function ContactAvatar({
  name,
  avatarUrl,
  size = "sm",
  className = "",
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: Size;
  className?: string;
}) {
  const sz = SIZE_CLASS[size];
  return (
    <Avatar className={`${sz} flex-shrink-0 ${className}`} data-testid="img-contact-avatar">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name || "Contact"} /> : null}
      <AvatarFallback className={`${colorFor(name)} font-semibold`}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
