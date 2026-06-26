import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Hash, Send, MessageSquare, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Channel {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isPrivate: boolean;
  unreadCount: number;
}

interface Message {
  id: number;
  channelId: number;
  userId: number;
  body: string;
  isEdited: boolean;
  createdAt: string;
  userName: string;
  userAvatarUrl: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  "bg-teal-600",
  "bg-cyan-600",
  "bg-blue-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-sky-600",
];

function avatarBg(userId: number): string {
  return AVATAR_PALETTE[userId % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatTs(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24)
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffHours < 48)
    return `Yesterday ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isGrouped(prev: Message | undefined, curr: Message): boolean {
  if (!prev) return false;
  if (prev.userId !== curr.userId) return false;
  return (
    new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() <
    5 * 60_000
  );
}

function displaySlug(slug: string): string {
  return slug.replace(/-/g, "\u2011"); // non-breaking hyphen — keeps it on one line
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageRow({
  message,
  grouped,
}: {
  message: Message;
  grouped: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 group hover:bg-white/[0.02] rounded-lg px-2 -mx-2 py-0.5 transition-colors",
        grouped ? "mt-0.5" : "mt-4 first:mt-0"
      )}
      data-testid={`message-row-${message.id}`}
    >
      {grouped ? (
        <div className="w-8 shrink-0" />
      ) : (
        <div
          className={cn(
            "w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white text-[11px] font-bold mt-0.5 overflow-hidden select-none",
            avatarBg(message.userId)
          )}
        >
          {message.userAvatarUrl ? (
            <img
              src={message.userAvatarUrl}
              alt={message.userName}
              className="w-full h-full object-cover"
            />
          ) : (
            initials(message.userName)
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-foreground leading-tight">
              {message.userName}
            </span>
            <span className="text-[11px] text-muted-foreground/60 shrink-0">
              {formatTs(message.createdAt)}
            </span>
            {message.isEdited && (
              <span className="text-[10px] text-muted-foreground/40 italic">
                edited
              </span>
            )}
          </div>
        )}
        <p className="text-[13.5px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
          {message.body}
        </p>
      </div>
    </div>
  );
}

function EmptyFeed({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20 select-none">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5 ring-1 ring-primary/10">
        <Hash className="w-8 h-8 text-primary/50" />
      </div>
      <h3 className="text-[15px] font-semibold text-foreground mb-1.5">
        Start the conversation
      </h3>
      <p className="text-sm text-muted-foreground max-w-[240px]">
        Be the first to post in{" "}
        <span className="text-primary font-medium">#{displaySlug(slug)}</span>
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CurrentPage() {
  const queryClient = useQueryClient();
  const [selectedSlug, setSelectedSlug] = useState<string>("general");
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const lastReadRef = useRef<number>(0);

  // Channels list with unread counts — 15s poll
  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ["/api/current/channels"],
    refetchInterval: 15_000,
  });

  // Messages for selected channel — 5s poll
  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ["/api/current/channels", selectedSlug, "messages"],
    queryFn: () =>
      fetch(`/api/current/channels/${selectedSlug}/messages`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 5_000,
    enabled: !!selectedSlug,
  });

  // Track scroll position to decide whether to auto-scroll
  function handleScroll() {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  }

  // Auto-scroll when new messages arrive (only if user is near the bottom)
  useEffect(() => {
    if (feedRef.current && isAtBottom.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  // When switching channels, always jump to bottom
  useEffect(() => {
    isAtBottom.current = true;
    lastReadRef.current = 0;
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [selectedSlug]);

  // Mark channel as read when messages load / update
  useEffect(() => {
    if (!selectedSlug || messages.length === 0) return;
    const lastId = messages[messages.length - 1].id;
    if (lastId === lastReadRef.current) return;
    lastReadRef.current = lastId;
    fetch(`/api/current/channels/${selectedSlug}/read`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadMessageId: lastId }),
    })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["/api/current/channels"] })
      )
      .catch(() => {});
  }, [selectedSlug, messages.length, queryClient]);

  // Post message mutation
  const postMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", `/api/current/channels/${selectedSlug}/messages`, {
        body,
      }),
    onSuccess: () => {
      setDraft("");
      isAtBottom.current = true;
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels", selectedSlug, "messages"],
      });
    },
  });

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || postMutation.isPending) return;
    postMutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const selectedChannel = channels.find((c) => c.slug === selectedSlug);
  const totalUnread = channels.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ── Channel sidebar ───────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-sidebar/40 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-semibold text-[13px] text-foreground tracking-tight">
              Current
            </span>
            {totalUnread > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* Section label */}
        <div className="px-4 pt-3 pb-1 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Currents
          </span>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-px">
          {channels.map((channel) => {
            const active = selectedSlug === channel.slug;
            return (
              <button
                key={channel.slug}
                data-testid={`channel-item-${channel.slug}`}
                onClick={() => setSelectedSlug(channel.slug)}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-all duration-100 group",
                  active
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                )}
              >
                <Hash
                  className={cn(
                    "w-3.5 h-3.5 shrink-0 transition-opacity",
                    active ? "opacity-80" : "opacity-40 group-hover:opacity-60"
                  )}
                />
                <span className="flex-1 truncate text-left">
                  {displaySlug(channel.slug)}
                </span>
                {channel.unreadCount > 0 && !active && (
                  <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                    {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                  </span>
                )}
                {channel.unreadCount > 0 && active && (
                  <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
                    {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Channel header bar */}
        <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2.5 shrink-0 bg-background/60 backdrop-blur-sm">
          <Hash className="w-4 h-4 text-muted-foreground/60 shrink-0" />
          <span className="font-semibold text-[14px] text-foreground">
            {displaySlug(selectedSlug)}
          </span>
          {selectedChannel?.description && (
            <>
              <div className="w-px h-4 bg-border/60 shrink-0 mx-0.5" />
              <span className="text-[12.5px] text-muted-foreground truncate">
                {selectedChannel.description}
              </span>
            </>
          )}
        </div>

        {/* Message feed */}
        <div
          ref={feedRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4 scroll-smooth"
          data-testid="message-feed"
        >
          {msgsLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 text-muted-foreground/40 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyFeed slug={selectedSlug} />
          ) : (
            <>
              {messages.map((msg, i) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  grouped={isGrouped(messages[i - 1], msg)}
                />
              ))}
              {/* Scroll anchor */}
              <div className="h-1" />
            </>
          )}
        </div>

        {/* Composer */}
        <div className="px-5 pt-3 pb-4 border-t border-border/60 shrink-0">
          <div
            className={cn(
              "flex items-end gap-2 bg-muted/30 border border-border/60 rounded-xl px-3.5 py-2.5 transition-all duration-150",
              "focus-within:border-primary/40 focus-within:bg-background focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]"
            )}
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${displaySlug(selectedSlug)}`}
              className="flex-1 border-0 bg-transparent shadow-none resize-none min-h-[22px] max-h-36 p-0 text-[13.5px] placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
              data-testid="composer-input"
            />
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!draft.trim() || postMutation.isPending}
              className="shrink-0 h-8 w-8 p-0 rounded-lg transition-all"
              data-testid="btn-send-message"
            >
              {postMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
          <p className="text-[10.5px] text-muted-foreground/35 mt-1.5 px-0.5 select-none">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
