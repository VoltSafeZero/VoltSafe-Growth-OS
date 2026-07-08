import { useState } from "react";
import {
  Download, ExternalLink, File, FileText, FileSpreadsheet, Archive,
  Code2, FileImage, FileVideo, Music, FileCog,
} from "lucide-react";

export interface CurrentAttachment {
  id: number;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getMimeIcon(mimeType: string) {
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

export function getMimeColor(mimeType: string): string {
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

export function getMimeBg(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "bg-violet-500/10";
  if (mimeType.startsWith("video/")) return "bg-rose-500/10";
  if (mimeType.startsWith("audio/")) return "bg-amber-500/10";
  if (mimeType === "application/pdf") return "bg-red-500/10";
  if (mimeType.includes("word") || mimeType.includes("document")) return "bg-blue-500/10";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return "bg-emerald-500/10";
  if (mimeType.includes("zip") || mimeType.includes("tar")) return "bg-yellow-500/10";
  if (mimeType.startsWith("text/") || mimeType.includes("javascript") || mimeType.includes("json")) return "bg-teal-500/10";
  return "bg-muted/40";
}

function fileUrl(fileName: string) {
  return `/api/attachments/file/${fileName}`;
}

function ImageAttachmentPreview({
  att,
  singleMode,
}: {
  att: CurrentAttachment;
  singleMode: boolean;
}) {
  // Resilience: if the image fails to load (corrupt file, deleted from disk,
  // unsupported/broken format, etc.), fall back to the generic file card
  // instead of leaving a broken-image icon or raw filename text in the feed.
  const [broken, setBroken] = useState(false);

  if (broken) {
    return <FileAttachmentCard att={att} />;
  }

  return (
    <div
      className="relative group/img rounded-xl overflow-hidden border border-border/30 shadow-sm hover:border-primary/30 hover:shadow-md transition-all shrink-0"
      data-testid={`current-attachment-img-${att.id}`}
      style={{ display: "inline-flex" }}
    >
      <a
        href={fileUrl(att.fileName)}
        target="_blank"
        rel="noopener noreferrer"
        title={att.originalName}
        className="block"
      >
        <img
          src={fileUrl(att.fileName)}
          alt={att.originalName}
          loading="lazy"
          className="block"
          style={{
            objectFit: "contain",
            maxWidth: singleMode ? 360 : 180,
            maxHeight: singleMode ? 280 : 160,
            minWidth: singleMode ? 80 : 60,
            minHeight: singleMode ? 40 : 40,
            display: "block",
          }}
          onError={() => setBroken(true)}
          data-testid={`current-attachment-img-error-${att.id}`}
        />
      </a>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-2 py-1.5 bg-gradient-to-t from-black/70 via-black/40 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity">
        <span className="text-[10.5px] text-white/85 truncate flex-1 min-w-0 leading-tight">
          {att.originalName}
        </span>
        <a
          href={fileUrl(att.fileName)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-0.5 rounded text-white/70 hover:text-white transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={fileUrl(att.fileName)}
          download={att.originalName}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-0.5 rounded text-white/70 hover:text-white transition-colors"
          title="Download"
        >
          <Download className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

export function FileAttachmentCard({ att }: { att: CurrentAttachment }) {
  const MimeIcon = getMimeIcon(att.mimeType);
  const iconColor = getMimeColor(att.mimeType);
  const iconBg = getMimeBg(att.mimeType);

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40 bg-muted/20 hover:bg-muted/40 hover:border-border/60 transition-all w-fit max-w-[340px]"
      data-testid={`current-attachment-file-${att.id}`}
    >
      <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${iconBg}`}>
        <MimeIcon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1 max-w-[180px]">
        <p className="text-[12.5px] font-medium text-foreground/85 truncate leading-tight">
          {att.originalName}
        </p>
        {att.fileSize > 0 && (
          <p className="text-[11px] text-muted-foreground/50 mt-0.5 leading-tight">
            {formatFileSize(att.fileSize)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <a
          href={fileUrl(att.fileName)}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href={fileUrl(att.fileName)}
          download={att.originalName}
          className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Download"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

export function CurrentAttachmentChips({
  attachments,
}: {
  attachments: CurrentAttachment[];
}) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const nonImages = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((att) => (
            <ImageAttachmentPreview
              key={att.id}
              att={att}
              singleMode={images.length === 1}
            />
          ))}
        </div>
      )}
      {nonImages.map((att) => (
        <FileAttachmentCard key={att.id} att={att} />
      ))}
    </div>
  );
}

export function FilesTabAttachments({
  attachments,
}: {
  attachments: CurrentAttachment[];
}) {
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const nonImages = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((att) => (
            <ImageAttachmentPreview key={att.id} att={att} singleMode={images.length === 1} />
          ))}
        </div>
      )}
      {nonImages.map((att) => (
        <FileAttachmentCard key={att.id} att={att} />
      ))}
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

export interface UploadResult {
  succeeded: number;
  failed: string[];
}

export async function uploadCurrentAttachments(
  messageId: number,
  files: File[]
): Promise<UploadResult> {
  const failed: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("objectType", "current_message");
        fd.append("objectId", String(messageId));
        fd.append("category", "general");
        const res = await fetch("/api/attachments", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        if (!res.ok) {
          failed.push(file.name);
        }
      } catch {
        failed.push(file.name);
      }
    })
  );
  return { succeeded: files.length - failed.length, failed };
}
