import {
  Download, File, FileText, FileSpreadsheet, Archive,
  Code2, FileImage, FileVideo, Music, FileCog,
} from "lucide-react";

export interface CurrentAttachment {
  id: number;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return Music;
  if (mimeType === "application/pdf") return FileText;
  if (mimeType.includes("word") || mimeType.includes("document")) return FileText;
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return FileSpreadsheet;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("7z") || mimeType.includes("rar")) return Archive;
  if (mimeType.startsWith("text/") || mimeType.includes("javascript") || mimeType.includes("json") || mimeType.includes("xml")) return Code2;
  if (mimeType.includes("octet-stream")) return FileCog;
  return File;
}

function getMimeColor(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "text-violet-400";
  if (mimeType.startsWith("video/")) return "text-rose-400";
  if (mimeType.startsWith("audio/")) return "text-amber-400";
  if (mimeType === "application/pdf") return "text-red-400";
  if (mimeType.includes("word") || mimeType.includes("document")) return "text-blue-400";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return "text-emerald-400";
  if (mimeType.includes("zip") || mimeType.includes("tar")) return "text-yellow-500";
  if (mimeType.startsWith("text/") || mimeType.includes("javascript") || mimeType.includes("json")) return "text-teal-400";
  return "text-muted-foreground";
}

export function CurrentAttachmentChips({ attachments }: { attachments: CurrentAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const nonImages = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((att) => (
            <a
              key={att.id}
              href={`/api/attachments/file/${att.fileName}`}
              target="_blank"
              rel="noopener noreferrer"
              title={att.originalName}
              data-testid={`current-attachment-img-${att.id}`}
              className="block rounded-md overflow-hidden border border-border/30 hover:border-primary/40 transition-colors shrink-0"
            >
              <img
                src={`/api/attachments/file/${att.fileName}`}
                alt={att.originalName}
                loading="lazy"
                className="object-cover"
                style={{
                  maxWidth: images.length === 1 ? 280 : 140,
                  maxHeight: images.length === 1 ? 200 : 120,
                  display: "block",
                }}
              />
            </a>
          ))}
        </div>
      )}
      {nonImages.map((att) => {
        const MimeIcon = getMimeIcon(att.mimeType);
        const iconColor = getMimeColor(att.mimeType);
        return (
          <a
            key={att.id}
            href={`/api/attachments/file/${att.fileName}`}
            download={att.originalName}
            data-testid={`current-attachment-file-${att.id}`}
            className="flex items-center gap-2 w-fit max-w-[300px] px-2.5 py-1.5 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/40 hover:border-border/70 transition-colors group"
          >
            <MimeIcon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
            <span className="text-xs text-foreground/80 truncate flex-1 min-w-0 max-w-[200px]">
              {att.originalName}
            </span>
            {att.fileSize > 0 && (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {formatFileSize(att.fileSize)}
              </span>
            )}
            <Download className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
          </a>
        );
      })}
    </div>
  );
}

export function PendingFileChips({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {files.map((file, i) => {
        const MimeIcon = getMimeIcon(file.type || "application/octet-stream");
        const iconColor = getMimeColor(file.type || "application/octet-stream");
        return (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-muted/30 text-xs max-w-[200px]"
            data-testid={`pending-file-${i}`}
          >
            <MimeIcon className={`h-3 w-3 shrink-0 ${iconColor}`} />
            <span className="truncate flex-1 min-w-0 text-foreground/80">{file.name}</span>
            <span className="text-muted-foreground/50 shrink-0">{formatFileSize(file.size)}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="h-3.5 w-3.5 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 ml-0.5"
              data-testid={`remove-pending-file-${i}`}
            >
              <svg viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5">
                <path d="M9 3L6 6m0 0L3 9m3-3L3 3m3 3l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export async function uploadCurrentAttachments(messageId: number, files: File[]): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("objectType", "current_message");
      fd.append("objectId", String(messageId));
      fd.append("category", "general");
      await fetch("/api/attachments", {
        method: "POST",
        body: fd,
        credentials: "include",
      }).catch(() => {});
    })
  );
}
