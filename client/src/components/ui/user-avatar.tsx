import { cn } from "@/lib/utils";

const AVATAR_PALETTE = [
  "bg-violet-600", "bg-blue-600", "bg-cyan-600", "bg-teal-600", "bg-emerald-600",
  "bg-amber-600", "bg-orange-600", "bg-rose-600", "bg-pink-600", "bg-indigo-600",
];

export function userAvatarBg(userId: number): string {
  return AVATAR_PALETTE[Math.abs(userId) % AVATAR_PALETTE.length];
}

export function userInitials(name: string): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type UserAvatarSize = "xxs" | "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<UserAvatarSize, string> = {
  xxs: "w-4 h-4 text-[7px]",
  xs:  "w-5 h-5 text-[8px]",
  sm:  "w-6 h-6 text-[9px]",
  md:  "w-8 h-8 text-[11px]",
  lg:  "w-10 h-10 text-[13px]",
  xl:  "w-16 h-16 text-[20px]",
};

interface UserAvatarProps {
  userId?: number | null;
  name: string;
  avatarUrl?: string | null;
  size?: UserAvatarSize;
  className?: string;
  alt?: string;
}

export function UserAvatar({ userId, name, avatarUrl, size = "md", className, alt }: UserAvatarProps) {
  const bg = userId != null ? userAvatarBg(userId) : "bg-muted";
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 overflow-hidden font-bold text-white select-none",
        SIZE_CLASSES[size],
        bg,
        className,
      )}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={alt ?? name}
          className="w-full h-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        userInitials(name)
      )}
    </div>
  );
}
