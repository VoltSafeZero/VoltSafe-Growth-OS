import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
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
    return `Yesterday ${d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isContinuation(prev: Message | undefined, curr: Message): boolean {
  if (!prev) return false;
  if (prev.userId !== curr.userId) return false;
  return (
    new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime() <
    5 * 60_000
  );
}

// Non-breaking hyphens keep channel names like #customer-success on one line
function displaySlug(slug: string): string {
  return slug.replace(/-/g, "\u2011");
}

// Adjust a textarea element's height to fit its content (capped at maxPx)
function growTextarea(el: HTMLTextAreaElement, maxPx = 144) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
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
        "flex gap-3 group hover:bg-white/[0.025] rounded-lg px-2 -mx-2 py-0.5 transition-colors",
        grouped ? "mt-0.5" : "mt-4 first:mt-0"
      )}
      data-testid={`message-row-${message.id}`}
    >
      {grouped ? (
        <div className="w-8 shrink-0" />
      ) : (
        <div
          className={cn(
            "w-8 h-8 shrink-0 rounded-full flex items-center justify-center",
            "text-white text-[11px] font-bold mt-0.5 overflow-hidden select-none",
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
        <span className="text-primary font-medium">
          #{displaySlug(slug)}
        </span>
      </p>
    </div>
  );
}

function ChannelSkeleton() {
  return (
    <div className="px-4 py-2 space-y-1">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="h-7 rounded-lg bg-muted/30 animate-pulse"
          style={{ width: `${60 + (i % 3) * 15}%` }}
        />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CurrentPage() {
  const queryClient = useQueryClient();
  const [selectedSlug, setSelectedSlug] = useState<string>("general");
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAtBottom = useRef(true);
  const lastReadRef = useRef<number>(0);

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Channels list with per-user unread counts — 15s poll
  const { data: channels = [], isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ["/api/current/channels"],
    refetchInterval: 15_000,
  });

  // Messages for the active channel — 5s poll.
  // keepPreviousData means switching to a cached channel shows stale data
  // immediately (no blank/spinner) while the fresh fetch completes.
  const {
    data: messages = [],
    isLoading: msgsLoading,
    isFetching: msgsFetching,
  } = useQuery<Message[]>({
    queryKey: ["/api/current/channels", selectedSlug, "messages"],
    queryFn: () =>
      fetch(`/api/current/channels/${selectedSlug}/messages`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 5_000,
    enabled: !!selectedSlug,
    placeholderData: keepPreviousData,
  });

  // ── Scroll management ──────────────────────────────────────────────────────

  // Track whether the user is near the bottom so we don't force-scroll when
  // they're reading history.
  function handleScroll() {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  }

  // Instant scroll to bottom helper — no CSS smooth-scroll animation so the
  // 5-second poll doesn't cause visible jitter.
  function scrollToBottom(instant = true) {
    const el = feedRef.current;
    if (!el) return;
    if (instant) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }

  // Auto-scroll when new messages arrive (only when near the bottom)
  useEffect(() => {
    if (isAtBottom.current) scrollToBottom();
  }, [messages.length]);                              // eslint-disable-line react-hooks/exhaustive-deps

  // When switching channels, always jump to the bottom immediately
  useEffect(() => {
    isAtBottom.current = true;
    lastReadRef.current = 0;
    scrollToBottom();
  }, [selectedSlug]);                                 // eslint-disable-line react-hooks/exhaustive-deps

  // ── Read receipts ──────────────────────────────────────────────────────────

  // Fire-and-forget mark-read whenever the open channel's message list grows.
  // Uses lastReadRef to debounce — won't re-fire if the last message ID hasn't
  // changed (e.g. on a poll cycle with no new messages).
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

  // ── Composer ───────────────────────────────────────────────────────────────

  const postMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", `/api/current/channels/${selectedSlug}/messages`, {
        body,
      }),
    onSuccess: () => {
      setDraft("");
      // Reset textarea height back to one line
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      isAtBottom.current = true;
      // Refresh both messages and sidebar unread counts
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels", selectedSlug, "messages"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/current/channels"],
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

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    growTextarea(e.target);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedChannel = channels.find((c) => c.slug === selectedSlug);
  const totalUnread = channels.reduce((s, c) => s + c.unreadCount, 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-background">

      {/* ── Channel sidebar ─────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-sidebar/40 overflow-hidden">

        {/* Module header */}
        <div className="px-4 py-3.5 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-semibold text-[13px] text-foreground tracking-tight">
              Current
            </span>
            {totalUnread > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
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
          {channelsLoading ? (
            <ChannelSkeleton />
          ) : (
            channels.map((channel) => {
              const active = selectedSlug === channel.slug;
              return (
                <button
                  key={channel.slug}
                  data-testid={`channel-item-${channel.slug}`}
                  onClick={() => setSelectedSlug(channel.slug)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px]",
                    "transition-all duration-100 group",
                    active
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <Hash
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 transition-opacity",
                      active
                        ? "opacity-80"
                        : "opacity-40 group-hover:opacity-60"
                    )}
                  />
                  <span className="flex-1 truncate text-left min-w-0">
                    {displaySlug(channel.slug)}
                  </span>
                  {channel.unreadCount > 0 && (
                    <span
                      className={cn(
                        "min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full",
                        "text-[10px] font-bold shrink-0",
                        active
                          ? "bg-primary/20 text-primary"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Main content area ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Channel header bar */}
        <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2.5 shrink-0 min-w-0">
          <Hash className="w-4 h-4 text-muted-foreground/60 shrink-0" />
          <span className="font-semibold text-[14px] text-foreground shrink-0">
            {displaySlug(selectedSlug)}
          </span>
          {selectedChannel?.description && (
            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
              <div className="w-px h-4 bg-border/60 shrink-0" />
              <span className="text-[12.5px] text-muted-foreground truncate">
                {selectedChannel.description}
              </span>
            </div>
          )}
          {/* Subtle refetch indicator — barely visible dot so the user knows
              data is fresh without any layout shift */}
          {msgsFetching && !msgsLoading && (
            <div className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-primary/30 animate-pulse" />
          )}
        </div>

        {/* Message feed — NO scroll-smooth to avoid animation jitter on polls */}
        <div
          ref={feedRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4"
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
                  grouped={isContinuation(messages[i - 1], msg)}
                />
              ))}
              {/* Bottom padding so the last message isn't flush against the composer */}
              <div className="h-2" />
            </>
          )}
        </div>

        {/* Composer — anchored at bottom, never overlaps the feed */}
        <div className="px-5 pt-3 pb-4 border-t border-border/60 shrink-0">
          <div
            className={cn(
              "flex items-end gap-2 rounded-xl px-3.5 py-2.5 transition-all duration-150",
              "bg-muted/30 border border-border/60",
              "focus-within:border-primary/40 focus-within:bg-background",
              "focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.07)]"
            )}
          >
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${displaySlug(selectedSlug)}`}
              className={cn(
                "flex-1 border-0 bg-transparent shadow-none resize-none p-0",
                "text-[13.5px] placeholder:text-muted-foreground/40 leading-relaxed",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
                "min-h-[22px] max-h-36 overflow-y-auto"
              )}
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
