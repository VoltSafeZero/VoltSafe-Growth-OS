import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Download, ExternalLink, MessageSquare,
  FileText, ChevronLeft, ChevronRight, X, AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatFileSize, getMimeIcon, getMimeColor, getMimeBg } from "./current-attachment-display";

export interface FilesTabItem {
  attachmentId: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploaderName: string;
  messageId: number;
  messageSnippet: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface FilesTabResponse {
  items: FilesTabItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CurrentFilesTabProps {
  channelSlug?: string | null;
  conversationId?: number | null;
  onJumpToMessage?: (messageId: number, snippet: string | null) => void;
}

const FILE_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "image", label: "Images" },
  { value: "pdf", label: "PDFs" },
  { value: "document", label: "Documents" },
  { value: "spreadsheet", label: "Spreadsheets" },
  { value: "presentation", label: "Presentations" },
  { value: "archive", label: "Archives" },
];

const PAGE_SIZE = 25;

export function CurrentFilesTab({ channelSlug, conversationId, onJumpToMessage }: CurrentFilesTabProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [fileType, setFileType] = useState("");
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }

  function handleTypeChange(value: string) {
    setFileType(value);
    setPage(1);
  }

  const params = new URLSearchParams();
  if (channelSlug) params.set("channel_slug", channelSlug);
  if (conversationId) params.set("conversation_id", String(conversationId));
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (fileType) params.set("file_type", fileType);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const enabled = !!(channelSlug || conversationId);

  const { data, isLoading, isError, isFetching } = useQuery<FilesTabResponse>({
    queryKey: ["/api/currents/files", channelSlug ?? null, conversationId ?? null, debouncedSearch, fileType, page],
    queryFn: () =>
      fetch(`/api/currents/files?${params}`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load files");
        return r.json();
      }),
    enabled,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const hasFilter = !!(debouncedSearch || fileType);

  return (
    <div className="flex flex-col h-full" data-testid="current-files-tab">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border/40 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input
            data-testid="files-search-input"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by filename or sender…"
            className="pl-8 h-8 text-[12.5px] bg-muted/30 border-border/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="files-type-filter">
          {FILE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTypeChange(opt.value)}
              data-testid={`files-type-${opt.value || "all"}`}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border",
                fileType === opt.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {isLoading && (
          <div className="space-y-2" data-testid="files-loading">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border/20 animate-pulse">
                <div className="w-9 h-9 rounded-lg bg-muted/40 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-muted/40 rounded w-2/3" />
                  <div className="h-2.5 bg-muted/30 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-12" data-testid="files-error">
            <AlertCircle className="w-8 h-8 text-destructive/50" />
            <p className="text-[13px] text-muted-foreground/60">Failed to load files.</p>
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && !hasFilter && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 select-none" data-testid="files-empty">
            <FileText className="w-12 h-12 text-muted-foreground/15" />
            <div className="text-center">
              <p className="text-[13px] font-medium text-muted-foreground/50">No files shared yet</p>
              <p className="text-[12px] text-muted-foreground/35 mt-1">
                Files attached to messages will appear here.
              </p>
            </div>
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && hasFilter && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12 select-none" data-testid="files-no-results">
            <Search className="w-8 h-8 text-muted-foreground/15" />
            <p className="text-[13px] text-muted-foreground/50">No files match your search.</p>
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <div className="space-y-1.5" data-testid="files-list">
            {items.map((item) => {
              const MimeIcon = getMimeIcon(item.mimeType);
              const iconColor = getMimeColor(item.mimeType);
              const iconBg = getMimeBg(item.mimeType);
              const dateStr = new Date(item.createdAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              });
              return (
                <div
                  key={item.attachmentId}
                  className="group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-border/30 bg-muted/10 hover:bg-muted/25 hover:border-border/50 transition-all"
                  data-testid={`file-row-${item.attachmentId}`}
                >
                  <div className={cn("w-9 h-9 shrink-0 rounded-lg flex items-center justify-center mt-0.5", iconBg)}>
                    <MimeIcon className={cn("h-4 w-4", iconColor)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[12.5px] font-medium text-foreground/85 truncate leading-tight"
                      data-testid={`file-name-${item.attachmentId}`}
                    >
                      {item.originalName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {item.fileSize > 0 && (
                        <span className="text-[11px] text-muted-foreground/50" data-testid={`file-size-${item.attachmentId}`}>
                          {formatFileSize(item.fileSize)}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground/40">·</span>
                      <span className="text-[11px] text-muted-foreground/50" data-testid={`file-uploader-${item.attachmentId}`}>
                        {item.uploaderName}
                      </span>
                      <span className="text-[11px] text-muted-foreground/40">·</span>
                      <span className="text-[11px] text-muted-foreground/40" data-testid={`file-date-${item.attachmentId}`}>
                        {dateStr}
                      </span>
                    </div>
                    {item.messageSnippet && (
                      <p className="text-[11px] text-muted-foreground/40 mt-0.5 truncate leading-tight">
                        {item.messageSnippet}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onJumpToMessage && (
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(item.messageId, item.messageSnippet)}
                        className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
                        title="Jump to message"
                        data-testid={`file-jump-${item.attachmentId}`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <a
                      href={item.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
                      title="Open in new tab"
                      data-testid={`file-open-${item.attachmentId}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href={item.downloadUrl}
                      download={item.originalName}
                      className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
                      title="Download"
                      data-testid={`file-download-${item.attachmentId}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!isLoading && totalPages > 1 && (
        <div className="px-4 py-2.5 border-t border-border/40 flex items-center justify-between shrink-0" data-testid="files-pagination">
          <span className="text-[11px] text-muted-foreground/50">
            {total} file{total !== 1 ? "s" : ""} · Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => p - 1)}
              className="h-7 w-7 p-0"
              data-testid="files-prev-page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => p + 1)}
              className="h-7 w-7 p-0"
              data-testid="files-next-page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
