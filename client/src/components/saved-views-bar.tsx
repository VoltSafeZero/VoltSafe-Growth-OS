import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, BookmarkCheck, X, Share2, Lock, ChevronDown } from "lucide-react";
import type { SavedView } from "@shared/schema";

interface SavedViewsBarProps {
  pageKey: string;
  activeViewId: number | null;
  currentFiltersJson?: string | null;
  currentSortBy?: string | null;
  currentSortOrder?: string | null;
  currentColumnsJson?: string | null;
  onApply: (view: SavedView) => void;
  onClear: () => void;
  className?: string;
}

export function SavedViewsBar({
  pageKey,
  activeViewId,
  currentFiltersJson,
  currentSortBy,
  currentSortOrder,
  currentColumnsJson,
  onApply,
  onClear,
  className = "",
}: SavedViewsBarProps) {
  const { toast } = useToast();
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(false);

  const { data: views = [] } = useQuery<SavedView[]>({
    queryKey: ["/api/saved-views", pageKey],
    queryFn: async () => {
      const res = await fetch(`/api/saved-views?pageKey=${pageKey}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ name, isShared }: { name: string; isShared: boolean }) => {
      const res = await apiRequest("POST", "/api/saved-views", {
        name, pageKey,
        filtersJson: currentFiltersJson ?? null,
        columnsJson: currentColumnsJson ?? null,
        sortBy: currentSortBy ?? null,
        sortOrder: currentSortOrder ?? "asc",
        isShared,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", pageKey] });
      setShowSaveForm(false);
      setSaveName("");
      toast({ title: "View saved" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/saved-views/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", pageKey] });
      if (activeViewId !== null) onClear();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("PATCH", `/api/saved-views/${id}/set-default`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", pageKey] });
      toast({ title: "Default view updated" });
    },
  });

  const updateViewMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await apiRequest("PUT", `/api/saved-views/${id}`, {
        filtersJson: currentFiltersJson ?? null,
        sortBy: currentSortBy ?? null,
        sortOrder: currentSortOrder ?? "asc",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", pageKey] });
      toast({ title: "View updated" });
    },
  });

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`} data-testid="saved-views-bar">
      {/* View chips */}
      {views.map(sv => {
        const isActive = sv.id === activeViewId;
        return (
          <div
            key={sv.id}
            className={`group inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border cursor-pointer select-none transition-all ${
              isActive
                ? "bg-primary/15 border-primary/50 text-primary font-semibold"
                : "bg-muted/30 border-border/30 text-muted-foreground hover:border-border/60 hover:text-foreground"
            }`}
            data-testid={`saved-view-chip-${sv.id}`}
            title={sv.isShared ? "Shared view" : "Private view"}
          >
            <button
              onClick={() => isActive ? onClear() : onApply(sv)}
              className="flex items-center gap-1"
            >
              {sv.isDefault && <BookmarkCheck className="h-2.5 w-2.5" />}
              {sv.isShared && !sv.isDefault && <Share2 className="h-2.5 w-2.5 opacity-60" />}
              {!sv.isShared && !sv.isDefault && <Lock className="h-2.5 w-2.5 opacity-40" />}
              <span>{sv.name}</span>
            </button>
            {/* Actions on hover */}
            <div className="hidden group-hover:flex items-center gap-0.5 ml-0.5">
              {isActive && (
                <button
                  onClick={e => { e.stopPropagation(); updateViewMutation.mutate({ id: sv.id }); }}
                  title="Update view with current filters"
                  className="text-primary/70 hover:text-primary transition-colors"
                  data-testid={`saved-view-update-${sv.id}`}
                >
                  <ChevronDown className="h-2.5 w-2.5 rotate-180" />
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); setDefaultMutation.mutate(sv.id); }}
                title={sv.isDefault ? "Already default" : "Set as default"}
                className={`transition-colors ${sv.isDefault ? "text-primary/60" : "text-muted-foreground/50 hover:text-primary"}`}
                data-testid={`saved-view-set-default-${sv.id}`}
              >
                <Bookmark className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); if (confirm(`Delete "${sv.name}"?`)) deleteMutation.mutate(sv.id); }}
                className="text-muted-foreground/30 hover:text-destructive transition-colors"
                data-testid={`saved-view-delete-${sv.id}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        );
      })}

      {/* Save current view button */}
      {showSaveForm ? (
        <div className="flex items-center gap-1" data-testid="save-view-form">
          <input
            autoFocus
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && saveName.trim()) saveMutation.mutate({ name: saveName.trim(), isShared: saveShared });
              if (e.key === "Escape") { setShowSaveForm(false); setSaveName(""); }
            }}
            placeholder="View name…"
            data-testid="input-save-view-name"
            className="text-[11px] px-2 py-1 bg-muted/20 border border-border/40 rounded focus:outline-none focus:border-primary/50 w-32 placeholder:text-muted-foreground/40"
          />
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={saveShared}
              onChange={e => setSaveShared(e.target.checked)}
              data-testid="checkbox-save-view-shared"
              className="h-2.5 w-2.5"
            />
            Shared
          </label>
          <button
            onClick={() => saveName.trim() && saveMutation.mutate({ name: saveName.trim(), isShared: saveShared })}
            disabled={!saveName.trim() || saveMutation.isPending}
            data-testid="button-save-view-confirm"
            className="text-[11px] px-2.5 py-1 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => { setShowSaveForm(false); setSaveName(""); }}
            className="text-[11px] text-muted-foreground/50 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSaveForm(true)}
          data-testid="button-save-view"
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-dashed border-border/30 text-muted-foreground/50 hover:border-border/60 hover:text-muted-foreground transition-all"
          title="Save current filters as a view"
        >
          <Bookmark className="h-2.5 w-2.5" />
          Save view
        </button>
      )}
    </div>
  );
}
