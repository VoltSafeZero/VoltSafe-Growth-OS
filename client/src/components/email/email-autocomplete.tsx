/**
 * Email address autocomplete components.
 *
 * EmailTokenInput        — chip-based multi-recipient input for compose To / CC / BCC.
 * EmailAutocompleteInput — single-address input with suggestion dropdown for CRM forms.
 *
 * Both query /api/email-autocomplete which unions:
 *   • CRM contacts (name + email)
 *   • Email history: senders (from_email) and sent-to recipients (to_emails)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Suggestion = { name: string | null; email: string };

function useEmailSuggestions(query: string): Suggestion[] {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < 1) { setSuggestions([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/email-autocomplete?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      } catch { /* network errors are silent */ }
    }, 160);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  return suggestions;
}

function parseEmails(val: string): string[] {
  if (!val.trim()) return [];
  return val.split(",").map(s => s.trim()).filter(Boolean);
}

interface DropdownProps {
  suggestions: Suggestion[];
  activeIndex: number;
  onSelect: (s: Suggestion) => void;
  onHover: (idx: number) => void;
  style: React.CSSProperties;
  dropdownRef: React.RefObject<HTMLDivElement>;
}

function SuggestionDropdown({ suggestions, activeIndex, onSelect, onHover, style, dropdownRef }: DropdownProps) {
  if (!suggestions.length) return null;
  return createPortal(
    <div
      ref={dropdownRef}
      style={style}
      className="bg-popover border border-border/50 rounded-lg shadow-2xl overflow-hidden py-1"
      data-testid="email-autocomplete-dropdown"
    >
      {suggestions.map((s, idx) => (
        <button
          key={s.email}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(s); }}
          onMouseEnter={() => onHover(idx)}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60 transition-colors",
            idx === activeIndex && "bg-muted/60"
          )}
        >
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center uppercase select-none">
            {(s.name ? s.name.charAt(0) : s.email.charAt(0))}
          </div>
          <div className="flex-1 min-w-0">
            {s.name && <div className="text-[13px] font-medium truncate leading-tight">{s.name}</div>}
            <div className={cn("truncate text-muted-foreground leading-tight", s.name ? "text-[11px]" : "text-[13px]")}>{s.email}</div>
          </div>
        </button>
      ))}
    </div>,
    document.body
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* EmailTokenInput — chip-based multi-recipient (compose To / CC / BCC)        */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface EmailTokenInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function EmailTokenInput({
  value,
  onChange,
  placeholder = "recipient@email.com",
  disabled = false,
  "data-testid": testId,
}: EmailTokenInputProps) {
  const [tokens, setTokens] = useState<string[]>(() => parseEmails(value));
  const [inputVal, setInputVal] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const prevValueRef = useRef(value);

  const suggestions = useEmailSuggestions(inputVal);

  useEffect(() => {
    setOpen(suggestions.length > 0 && inputVal.trim().length > 0);
    setActiveIndex(-1);
  }, [suggestions, inputVal]);

  useEffect(() => {
    if (value === prevValueRef.current) return;
    prevValueRef.current = value;
    if (!inputVal) setTokens(parseEmails(value));
  }, [value, inputVal]);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: Math.max(rect.width, 260),
      zIndex: 99999,
    });
  }, [open, tokens.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!containerRef.current?.contains(t) && !dropdownRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const commitTokens = useCallback((next: string[]) => {
    setTokens(next);
    onChange(next.join(", "));
  }, [onChange]);

  const addToken = useCallback((raw: string) => {
    const t = raw.trim().replace(/,+$/, "").trim();
    if (!t) return;
    commitTokens([...tokens, t]);
    setInputVal("");
    setOpen(false);
  }, [tokens, commitTokens]);

  const removeToken = useCallback((idx: number) => {
    commitTokens(tokens.filter((_, i) => i !== idx));
  }, [tokens, commitTokens]);

  const selectSuggestion = useCallback((s: Suggestion) => {
    const formatted = s.name ? `${s.name} <${s.email}>` : s.email;
    addToken(formatted);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [addToken]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v.includes(",")) {
      // Handle both typed comma-confirmations and pasted comma-separated lists.
      // Split on every comma: parts before the last are definitely complete tokens;
      // the last part is either empty (trailing comma) or still being typed.
      const parts = v.split(",");
      const hasTrailingComma = v.endsWith(",");
      const complete = (hasTrailingComma ? parts : parts.slice(0, -1))
        .map(s => s.trim()).filter(Boolean);
      const remaining = hasTrailingComma ? "" : parts[parts.length - 1].trim();
      if (complete.length > 0) {
        commitTokens([...tokens, ...complete]);
      }
      setInputVal(remaining);
      setOpen(false);
    } else {
      setInputVal(v);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); return; }
    if (e.key === "Escape") { setOpen(false); return; }
    if ((e.key === "Enter" || e.key === "Tab") && open && activeIndex >= 0) {
      e.preventDefault();
      const s = suggestions[activeIndex];
      if (s) selectSuggestion(s);
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); if (inputVal.trim()) addToken(inputVal); return; }
    if (e.key === "Tab" && inputVal.trim()) { addToken(inputVal); return; }
    if (e.key === "Backspace" && !inputVal && tokens.length > 0) { removeToken(tokens.length - 1); return; }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement === inputRef.current) return;
      if (dropdownRef.current?.contains(document.activeElement)) return;
      if (inputVal.trim()) addToken(inputVal);
      setOpen(false);
    }, 200);
  };

  return (
    <>
      <div
        ref={containerRef}
        className="flex flex-1 flex-wrap items-center gap-1 cursor-text"
        onClick={() => !disabled && inputRef.current?.focus()}
        data-testid={testId}
      >
        {tokens.map((token, idx) => (
          <span
            key={`${idx}-${token}`}
            className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 bg-primary/10 text-primary text-[11.5px] rounded-full border border-primary/20 max-w-[260px] flex-shrink-0"
          >
            <span className="truncate">{token}</span>
            {!disabled && (
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); removeToken(idx); }}
                className="flex-shrink-0 ml-0.5 text-primary/50 hover:text-primary transition-colors rounded-full hover:bg-primary/15 p-0.5"
                aria-label={`Remove ${token}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputVal}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tokens.length === 0 ? placeholder : ""}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-[100px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/35 disabled:opacity-50"
        />
      </div>
      {open && (
        <SuggestionDropdown
          suggestions={suggestions}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
          onHover={setActiveIndex}
          style={dropStyle}
          dropdownRef={dropdownRef}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* EmailAutocompleteInput — single-address input with dropdown (CRM forms)     */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface EmailAutocompleteInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
  className?: string;
  autoComplete?: string;
}

export function EmailAutocompleteInput({
  value,
  onChange,
  placeholder = "name@example.com",
  disabled = false,
  id,
  "data-testid": testId,
  className,
  autoComplete = "off",
}: EmailAutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});

  const suggestions = useEmailSuggestions(value);

  useEffect(() => {
    setOpen(suggestions.length > 0 && value.trim().length > 0);
    setActiveIndex(-1);
  }, [suggestions, value]);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      minWidth: 240,
      zIndex: 99999,
    });
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!inputRef.current?.contains(t) && !dropdownRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectSuggestion = (s: Suggestion) => {
    onChange(s.email);
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); }
    else if ((e.key === "Enter" || e.key === "Tab") && activeIndex >= 0) {
      e.preventDefault();
      const s = suggestions[activeIndex];
      if (s) selectSuggestion(s);
    } else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => {
          if (!dropdownRef.current?.contains(document.activeElement)) setOpen(false);
        }, 200)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        spellCheck={false}
        data-testid={testId}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />
      {open && (
        <SuggestionDropdown
          suggestions={suggestions}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
          onHover={setActiveIndex}
          style={dropStyle}
          dropdownRef={dropdownRef}
        />
      )}
    </>
  );
}
