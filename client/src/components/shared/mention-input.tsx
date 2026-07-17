/**
 * mention-input.tsx
 *
 * Drop-in textarea replacement that supports @mention autocomplete.
 *
 * DISPLAY RULE: the textarea ALWAYS shows clean human-readable text.
 *   Typing @scott, clicking Scott → textarea shows "@Scott " — never "@[Scott](user:138)".
 *
 * Token format (@[Name](user:ID)) is used only for DB storage.
 * Use the ref handle to convert before saving:
 *
 *   const ref = useRef<MentionInputHandle>(null);
 *   // On load:  setVal(tokensToCleanText(initial))  +  ref.current?.initFromTokenText(initial)
 *   // On save:  const toStore = ref.current?.getTokenizedValue(val) ?? val
 */

import { forwardRef, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useMentionComposer, tokensToCleanText, type MentionUser } from "@/hooks/use-mention-composer";

// Reusable avatarBg helper (deterministic colour from user id)
const AVATAR_COLOURS = [
  "bg-rose-600", "bg-orange-600", "bg-amber-600", "bg-yellow-600",
  "bg-lime-600",  "bg-emerald-600","bg-teal-600", "bg-cyan-600",
  "bg-sky-600",   "bg-blue-600",   "bg-violet-600","bg-purple-600",
  "bg-fuchsia-600","bg-pink-600",
];
function avatarBg(id: number) {
  return AVATAR_COLOURS[id % AVATAR_COLOURS.length];
}
function initials(name: string) {
  return name.split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/** Render body text containing @[Name](user:ID) tokens as styled chips.
 *  Works on stored token format — never call with clean text unless no tokens exist. */
export function renderMentionBody(
  body: string | null,
  myUserId?: number
): React.ReactNode {
  if (!body) return null;
  const re = /@\[([^\]]+)\]\(user:(\d+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) parts.push(<span key={key++}>{body.slice(last, match.index)}</span>);
    const name = match[1];
    const uid = Number(match[2]);
    const isMe = !!myUserId && uid === myUserId;
    const isAll = uid === 0;
    parts.push(
      <span
        key={key++}
        className={cn(
          "inline-flex items-center rounded px-1 text-[12.5px] font-semibold leading-tight",
          isAll ? "bg-amber-500/20 text-amber-400" :
          isMe  ? "bg-primary/20 text-primary" :
                  "bg-muted/80 text-foreground/90"
        )}
      >
        @{name}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < (body?.length ?? 0)) parts.push(<span key={key++}>{body.slice(last)}</span>);
  if (parts.length === 0) return <>{body}</>;
  return <>{parts}</>;
}

function MentionDropdown({
  users,
  isLoading,
  anchorRect,
  activeIdx,
  onSelect,
  onHover,
}: {
  users: MentionUser[];
  isLoading: boolean;
  anchorRect: { top: number; left: number; width: number };
  activeIdx: number;
  onSelect: (user: MentionUser) => void;
  onHover: (idx: number) => void;
}) {
  const el = (
    <div
      style={{
        position: "fixed",
        bottom: window.innerHeight - anchorRect.top + 6,
        left: anchorRect.left,
        minWidth: Math.max(anchorRect.width, 220),
        maxWidth: 340,
        zIndex: 9999,
      }}
      className="bg-popover border border-border/70 rounded-lg shadow-xl overflow-hidden py-1"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Searching…
        </div>
      ) : users.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">No teammates found</div>
      ) : (
        users.map((user, idx) => (
          <button
            key={user.isAll ? "all" : user.id}
            onMouseDown={(e) => { e.preventDefault(); onSelect(user); }}
            onMouseEnter={() => onHover(idx)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
              idx === activeIdx ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/60"
            )}
          >
            {user.isAll ? (
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-amber-600">
                <Users className="w-3.5 h-3.5 text-white" />
              </div>
            ) : (
              <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white", avatarBg(user.id))}>
                {initials(user.name)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium leading-none truncate">
                {user.isAll ? "everyone (notify all)" : user.name}
              </div>
              {!user.isAll && user.department && (
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{user.department}</div>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  );
  return createPortal(el, document.body);
}

export interface MentionInputHandle {
  /** Convert clean-text editor value → token format for DB storage. */
  getTokenizedValue(cleanText: string): string;
  /** Pre-populate mention registry from a stored token string (call when entering edit mode). */
  initFromTokenText(tokenText: string): void;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  "data-testid"?: string;
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(
  function MentionInput(
    {
      value,
      onChange,
      onSubmit,
      placeholder = "Write something… type @ to mention someone",
      rows,
      disabled,
      autoFocus,
      className,
      "data-testid": testId,
    },
    ref
  ) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    const prevValueRef = useRef(value);
    const mention = useMentionComposer(taRef);

    useImperativeHandle(ref, () => ({
      getTokenizedValue: (cleanText: string) => mention.serializeForSave(cleanText),
      initFromTokenText: (tokenText: string) => mention.initFromTokenText(tokenText),
    }));

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const newVal = e.target.value;
      // Keep mention entry positions in sync with every keystroke
      mention.updateEntryPositions(prevValueRef.current, newVal);
      prevValueRef.current = newVal;
      onChange(newVal);
      mention.onValueChange(newVal, e.target.selectionStart ?? newVal.length);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (mention.handleMentionKeyDown(e, value, onChange)) return;
      if (e.key === "Enter" && !e.shiftKey && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    }

    // Guard: if parent passes a token-format string (from a non-migrated call site),
    // show clean text anyway so raw tokens are never visible.
    const displayValue = /@\[/.test(value) ? tokensToCleanText(value) : value;

    return (
      <div className="relative">
        <Textarea
          ref={taRef}
          value={displayValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          autoFocus={autoFocus}
          className={cn("resize-none", className)}
          data-testid={testId}
        />
        {mention.mentionActive && mention.mentionAnchorRect && (
          <MentionDropdown
            users={mention.mentionUsers}
            isLoading={mention.mentionLoading}
            anchorRect={mention.mentionAnchorRect}
            activeIdx={mention.mentionIdx}
            onSelect={(u) => mention.insertMention(value, onChange, u)}
            onHover={mention.setMentionIdx}
          />
        )}
      </div>
    );
  }
);
