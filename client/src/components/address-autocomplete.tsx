import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Search, Loader2, MapPin } from "lucide-react";

type Suggestion = {
  lat: number;
  lng: number;
  display_name: string;
};

interface AddressAutocompleteProps {
  onSelect: (lat: number, lng: number, displayName: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}

export default function AddressAutocomplete({
  onSelect,
  placeholder = "Search address, city, or marina...",
  className = "",
  testId = "input-address-autocomplete",
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/geocode/search?q=${encodeURIComponent(q)}&limit=5`,
        { credentials: "include", signal: controller.signal }
      );
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      if (!controller.signal.aborted) {
        const results = Array.isArray(data) ? data : [data];
        setSuggestions(results);
        setOpen(results.length > 0);
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setSuggestions([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const handleSelect = (s: Suggestion) => {
    setQuery(s.display_name);
    setSuggestions([]);
    setOpen(false);
    onSelect(s.lat, s.lng, s.display_name);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const formatName = (name: string) => {
    const parts = name.split(", ");
    if (parts.length > 3) {
      return parts.slice(0, 3).join(", ");
    }
    return name;
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground z-10" />
      {loading && <Loader2 className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin z-10" />}
      <Input
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions.length > 0) {
            e.preventDefault();
            handleSelect(suggestions[0]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        className="pl-8 h-8 text-xs bg-secondary/30 border-border/50"
        data-testid={testId}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border/50 rounded-lg shadow-lg overflow-hidden z-50 max-h-[200px] overflow-y-auto" data-testid="address-suggestions-list">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 text-xs hover:bg-secondary/50 transition-colors flex items-start gap-2 border-b border-border/20 last:border-0"
              onClick={() => handleSelect(s)}
              data-testid={`address-suggestion-${i}`}
            >
              <MapPin className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
              <span className="text-foreground leading-tight">{formatName(s.display_name)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}