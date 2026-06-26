import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  GraduationCap, PlayCircle, Clock, ChevronRight,
  BookOpen, Lock, FileText, Sparkles, AlertTriangle,
  CheckCircle2, VideoOff, Film, Radio, ListChecks,
  ArrowRight, Check, X, ArrowLeft,
} from "lucide-react";
import { isDemoModeActive } from "@/lib/demo-mode";
import {
  TRAINING_PLAYLISTS,
  TRAINING_VIDEOS,
  FUTURE_VIDEOS,
  type TrainingPlaylist,
  type TrainingVideo,
  type VideoStatus,
} from "@/data/training-hub";

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_META: Record<VideoStatus, {
  label: string;
  badgeClass: string;
  icon: React.ElementType;
  buttonLabel: string;
  buttonEnabled: boolean;
  buttonClass: string;
}> = {
  hosted: {
    label: "Hosted",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: CheckCircle2,
    buttonLabel: "Watch Video",
    buttonEnabled: true,
    buttonClass: "bg-cyan-600 hover:bg-cyan-500 text-white",
  },
  edited: {
    label: "Edited",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    icon: Film,
    buttonLabel: "Final MP4 Ready",
    buttonEnabled: false,
    buttonClass: "border-blue-500/40 text-blue-400",
  },
  raw_recorded: {
    label: "Raw Recorded",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    icon: Radio,
    buttonLabel: "Raw Recording Ready",
    buttonEnabled: false,
    buttonClass: "border-amber-500/40 text-amber-400",
  },
  not_recorded: {
    label: "Not Recorded",
    badgeClass: "bg-muted/60 text-muted-foreground border-border/40",
    icon: VideoOff,
    buttonLabel: "Not Recorded Yet",
    buttonEnabled: false,
    buttonClass: "border-border/40 text-muted-foreground",
  },
  needs_update: {
    label: "Needs Update",
    badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
    icon: AlertTriangle,
    buttonLabel: "Needs Update",
    buttonEnabled: false,
    buttonClass: "border-red-500/40 text-red-400",
  },
};

function isAdminRole(role?: string) {
  return role === "admin" || role === "master_admin";
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: VideoStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.badgeClass}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

// ── Playlist card ─────────────────────────────────────────────────────────────

function PlaylistCard({
  playlist,
  canSeeDevLinks,
  onSelect,
}: {
  playlist: TrainingPlaylist;
  canSeeDevLinks: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Card
      data-testid={`playlist-card-${playlist.id}`}
      className="bg-card border-border/50 hover:border-cyan-500/40 transition-colors flex flex-col"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5" role="img" aria-label={playlist.title}>
            {playlist.icon}
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground text-base leading-tight">
              {playlist.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{playlist.audience}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 flex flex-col flex-1 gap-3">
        <p className="text-sm text-muted-foreground leading-relaxed">{playlist.description}</p>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            {playlist.estimatedTime}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <PlayCircle className="h-3 w-3" />
            {playlist.videoIds.length} video{playlist.videoIds.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {playlist.videoIds.map((vid) => {
            const v = TRAINING_VIDEOS.find((x) => x.id === vid);
            return v ? (
              <Badge
                key={vid}
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground"
              >
                {v.number}. {v.title}
              </Badge>
            ) : null;
          })}
        </div>

        <div className="mt-auto pt-2 flex items-center gap-2">
          <Button
            data-testid={`button-view-playlist-${playlist.id}`}
            size="sm"
            className="bg-cyan-600 hover:bg-cyan-500 text-white flex-1"
            onClick={() => onSelect(playlist.id)}
          >
            View Playlist <ChevronRight className="h-3 w-3 ml-1" />
          </Button>

          {canSeeDevLinks && (
            <Button
              data-testid={`button-copy-path-${playlist.id}`}
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground px-2"
              title={`Copy path: ${playlist.filePath}`}
              onClick={() => navigator.clipboard?.writeText(playlist.filePath).catch(() => {})}
            >
              <FileText className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Playlist viewer ────────────────────────────────────────────────────────────

function PlaylistViewer({
  playlistId,
  canSeeDevLinks,
  onBack,
}: {
  playlistId: string;
  canSeeDevLinks: boolean;
  onBack: () => void;
}) {
  const playlist = TRAINING_PLAYLISTS.find((p) => p.id === playlistId);

  if (!playlist) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="playlist-back-button"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to playlists
        </button>
        <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Playlist not found: <code className="font-mono">{playlistId}</code></p>
        </div>
      </div>
    );
  }

  const videos = playlist.videoIds
    .map((id) => TRAINING_VIDEOS.find((v) => v.id === id))
    .filter(Boolean) as TrainingVideo[];

  return (
    <div className="space-y-6" data-testid={`playlist-viewer-${playlistId}`}>
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="playlist-back-button"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to playlists
      </button>

      {/* Header card */}
      <Card className="bg-card border-border/50">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-4">
            <span className="text-4xl leading-none shrink-0" role="img" aria-label={playlist.title}>
              {playlist.icon}
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-foreground leading-tight">{playlist.title}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{playlist.audience}</p>
              <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                {playlist.description}
              </p>
              <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {playlist.estimatedTime}
                </span>
                <span className="flex items-center gap-1">
                  <PlayCircle className="h-3 w-3" />
                  {playlist.videoIds.length} video{playlist.videoIds.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Video list */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Watch in this order</h3>
        {videos.map((video, idx) => {
          const meta = STATUS_META[video.status];
          const StatusIcon = meta.icon;
          return (
            <Card
              key={video.id}
              className="bg-card border-border/50 hover:border-cyan-500/30 transition-colors"
              data-testid={`playlist-video-${video.id}`}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  {/* Step number */}
                  <div className="w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-cyan-400">{idx + 1}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">
                        {video.number}. {video.title}
                      </span>
                      <Badge className={`text-[10px] px-1.5 py-0 border ${meta.badgeClass}`}>
                        <StatusIcon className="h-2.5 w-2.5 mr-1" />
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {video.description}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {video.duration}
                    </p>
                  </div>

                  {/* Watch button */}
                  <div className="shrink-0">
                    {video.status === "hosted" && video.videoUrl ? (
                      <Button
                        size="sm"
                        className="bg-cyan-600 hover:bg-cyan-500 text-white"
                        onClick={() => window.open(video.videoUrl!, "_blank", "noopener")}
                        data-testid={`watch-video-${video.id}`}
                      >
                        <PlayCircle className="h-3 w-3 mr-1" />
                        Watch Video
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        className="text-muted-foreground/40 border-border/20 cursor-not-allowed"
                        data-testid={`watch-video-${video.id}`}
                      >
                        Not Published Yet
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Not yet hosted notice */}
      {!videos.some((v) => v.status === "hosted") && (
        <div className="flex items-start gap-3 bg-muted/20 border border-border/30 rounded-lg px-4 py-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-0.5">Videos coming soon</p>
            <p>
              These videos are being recorded and edited. Check back soon — they'll be watchable
              here once published.
            </p>
          </div>
        </div>
      )}

      {canSeeDevLinks && (
        <div className="text-xs text-muted-foreground/60 bg-muted/20 rounded-lg p-3 border border-border/30">
          <p className="font-medium text-muted-foreground mb-1">Dev: source file</p>
          <p className="font-mono">{playlist.filePath}</p>
        </div>
      )}
    </div>
  );
}

// ── Video row ─────────────────────────────────────────────────────────────────

function VideoRow({
  video,
  canSeeDevLinks,
}: {
  video: TrainingVideo;
  canSeeDevLinks: boolean;
}) {
  const meta = STATUS_META[video.status];
  const isEnabled = meta.buttonEnabled && !!video.videoUrl;

  return (
    <div
      data-testid={`video-row-${video.id}`}
      className="flex items-start gap-4 p-4 rounded-lg border border-border/40 bg-card/50 hover:bg-card hover:border-border/70 transition-colors"
    >
      {/* Number badge */}
      <div className="shrink-0 w-9 h-9 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
        <span className="text-xs font-bold text-cyan-400">{video.number}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h4 className="font-semibold text-foreground text-sm">{video.title}</h4>
          <StatusBadge status={video.status} />
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground"
          >
            <Clock className="h-2.5 w-2.5 mr-1" />
            {video.duration}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-2">{video.description}</p>

        <div className="flex flex-wrap gap-1">
          {video.audiences.map((a) => (
            <Badge
              key={a}
              className="text-[10px] px-1.5 py-0 bg-muted/60 text-muted-foreground border-0"
            >
              {a}
            </Badge>
          ))}
        </div>

        {/* Dev-only paths */}
        {canSeeDevLinks && (
          <div className="mt-2 space-y-0.5">
            {video.rawVideoPath && (
              <p className="text-[10px] font-mono text-muted-foreground/50 break-all leading-tight">
                raw: {video.rawVideoPath}
              </p>
            )}
            {video.finalVideoPath && (
              <p className="text-[10px] font-mono text-muted-foreground/50 break-all leading-tight">
                final: {video.finalVideoPath}
              </p>
            )}
            {video.storyboardPath && (
              <p className="text-[10px] font-mono text-muted-foreground/50 break-all leading-tight">
                storyboard: {video.storyboardPath}
              </p>
            )}
            {video.videoUrl && (
              <p className="text-[10px] font-mono text-cyan-400/70 break-all leading-tight">
                url: {video.videoUrl}
              </p>
            )}
            {video.hostedProvider && (
              <p className="text-[10px] font-mono text-muted-foreground/50 leading-tight">
                provider: {video.hostedProvider}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-col gap-1.5 items-end">
        {isEnabled ? (
          <Button
            data-testid={`button-watch-${video.id}`}
            size="sm"
            className={`${meta.buttonClass} text-xs whitespace-nowrap`}
            onClick={() => window.open(video.videoUrl!, "_blank", "noopener")}
          >
            <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
            {meta.buttonLabel}
          </Button>
        ) : (
          <Button
            data-testid={`button-watch-${video.id}`}
            size="sm"
            variant="outline"
            disabled
            className={`${meta.buttonClass} text-xs whitespace-nowrap`}
          >
            <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
            {meta.buttonLabel}
          </Button>
        )}

        {canSeeDevLinks && (
          <Button
            data-testid={`button-storyboard-${video.id}`}
            size="sm"
            variant="ghost"
            className="text-[11px] text-muted-foreground hover:text-cyan-400 whitespace-nowrap px-2"
            onClick={() =>
              navigator.clipboard?.writeText(video.storyboardPath).catch(() => {})
            }
            title={`Copy storyboard path: ${video.storyboardPath}`}
          >
            <BookOpen className="h-3 w-3 mr-1" />
            Storyboard
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Future video card ─────────────────────────────────────────────────────────

function FutureVideoCard({
  title,
  description,
  targetAudiences,
}: {
  title: string;
  description: string;
  targetAudiences: string[];
}) {
  return (
    <div
      data-testid={`future-video-${title.toLowerCase().replace(/[\s/]+/g, "-")}`}
      className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-border/30 bg-muted/10"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 border-border/40 text-muted-foreground/60 shrink-0"
        >
          Coming soon
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground/60 leading-relaxed">{description}</p>
      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {targetAudiences.map((a) => (
          <span
            key={a}
            className="text-[10px] text-muted-foreground/50 bg-muted/30 rounded px-1.5 py-0.5"
          >
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Publishing checklist (admin/demo only) ────────────────────────────────────

const NEXT_ACTION_LABEL: Record<VideoStatus, string> = {
  not_recorded:  "Run recording script",
  raw_recorded:  "Edit into MP4",
  edited:        "Upload & paste hosted URL",
  hosted:        "Ready ✅",
  needs_update:  "Re-record or update",
};

function PublishingChecklist() {
  const total       = TRAINING_VIDEOS.length;
  const hosted      = TRAINING_VIDEOS.filter((v) => v.status === "hosted").length;
  const edited      = TRAINING_VIDEOS.filter((v) => v.status === "edited").length;
  const rawRecorded = TRAINING_VIDEOS.filter((v) => v.status === "raw_recorded").length;
  const notRecorded = TRAINING_VIDEOS.filter((v) => v.status === "not_recorded").length;
  const needsUpdate = TRAINING_VIDEOS.filter((v) => v.status === "needs_update").length;

  const progressPct = total > 0 ? Math.round((hosted / total) * 100) : 0;

  let nextAction: string;
  if (needsUpdate > 0)        nextAction = "Re-record or update stale videos first";
  else if (rawRecorded > 0)   nextAction = "Edit raw recordings into final MP4s";
  else if (edited > 0)        nextAction = "Upload edited MP4s and paste hosted URLs";
  else if (notRecorded > 0)   nextAction = "Run npm recording scripts for remaining videos";
  else                         nextAction = "All onboarding videos are hosted and ready.";

  const allDone = hosted === total;

  function hasRaw(v: TrainingVideo) {
    return !!v.rawVideoPath && ["raw_recorded", "edited", "hosted", "needs_update"].includes(v.status);
  }
  function hasFinal(v: TrainingVideo) {
    return !!v.finalVideoPath && ["edited", "hosted", "needs_update"].includes(v.status);
  }
  function hasUrl(v: TrainingVideo) {
    return !!v.videoUrl && v.status === "hosted";
  }
  function hasStoryboard(v: TrainingVideo) {
    return !!v.storyboardPath;
  }

  return (
    <Card
      data-testid="publishing-checklist"
      className="border-amber-500/20 bg-amber-400/5"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-amber-300">Publishing Checklist</h2>
          <span className="text-xs text-amber-400/60 ml-auto">admin only</span>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-5">

        {/* ── Count summary ── */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {[
            { label: "Total",       value: total,       cls: "text-foreground" },
            { label: "Hosted",      value: hosted,      cls: "text-emerald-400" },
            { label: "Edited",      value: edited,      cls: "text-blue-400" },
            { label: "Raw",         value: rawRecorded, cls: "text-amber-400" },
            { label: "Not started", value: notRecorded, cls: "text-muted-foreground" },
            { label: "Stale",       value: needsUpdate, cls: "text-red-400" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-muted/20 rounded-lg px-2 py-2">
              <div className={`text-lg font-bold ${cls}`}>{value}</div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Progress bar ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span data-testid="checklist-progress-label">
              {hosted} of {total} video{total !== 1 ? "s" : ""} hosted
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
            <div
              data-testid="checklist-progress-bar"
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* ── Next action ── */}
        <div className="flex items-start gap-2 rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
          <ArrowRight className={`h-3.5 w-3.5 shrink-0 mt-px ${allDone ? "text-emerald-400" : "text-amber-400"}`} />
          <div className="text-xs">
            <span className="font-medium text-foreground">Next action: </span>
            <span className="text-muted-foreground">{nextAction}</span>
          </div>
        </div>

        {/* ── Per-video table ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="checklist-table">
            <thead>
              <tr className="border-b border-border/30 text-muted-foreground">
                <th className="text-left py-2 pr-3 font-medium">Video</th>
                <th className="text-left py-2 pr-3 font-medium">Status</th>
                <th className="text-center py-2 px-2 font-medium">Raw</th>
                <th className="text-center py-2 px-2 font-medium">MP4</th>
                <th className="text-center py-2 px-2 font-medium">URL</th>
                <th className="text-center py-2 px-2 font-medium">Script</th>
                <th className="text-left py-2 pl-3 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {TRAINING_VIDEOS.map((v) => (
                <tr key={v.id} data-testid={`checklist-row-${v.id}`}>
                  <td className="py-2 pr-3 text-foreground whitespace-nowrap">
                    {v.number}. {v.title}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    {hasRaw(v)
                      ? <Check className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                      : <X className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {hasFinal(v)
                      ? <Check className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                      : <X className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {hasUrl(v)
                      ? <Check className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                      : <X className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {hasStoryboard(v)
                      ? <Check className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                      : <X className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />}
                  </td>
                  <td className="py-2 pl-3 text-muted-foreground whitespace-nowrap">
                    {NEXT_ACTION_LABEL[v.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer note ── */}
        <p className="text-[11px] text-muted-foreground/60">
          For publishing instructions, see{" "}
          <code className="bg-muted/40 px-1 rounded">onboarding-videos/HOSTING.md</code>.
        </p>

      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TrainingHubPage() {
  const [activeSection, setActiveSection] = useState<"playlists" | "library" | "future">(
    "playlists",
  );
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  const { data: user } = useQuery<{ globalRole?: string; name?: string }>({
    queryKey: ["/api/auth/me"],
  });

  const canSeeDevLinks = isDemoModeActive() || isAdminRole(user?.globalRole);

  const sections = [
    { id: "playlists", label: "Learning Paths" },
    { id: "library", label: "Video Library" },
    { id: "future", label: "Coming Soon" },
  ] as const;

  // Summary counts for the library tab label
  const hostedCount = TRAINING_VIDEOS.filter((v) => v.status === "hosted").length;
  const totalCount = TRAINING_VIDEOS.length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <GraduationCap className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1
                className="text-xl font-bold text-foreground leading-tight"
                data-testid="training-hub-title"
              >
                VoltSafe CMS Training Hub
              </h1>
              <p className="text-xs text-muted-foreground">
                Role-based walkthroughs, onboarding videos, and workflow guides
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Learn how to use VoltSafe CMS through role-based walkthroughs, onboarding videos, and
            workflow guides. Pick your role below to find the right learning path — or browse the
            full video library.
          </p>

          {canSeeDevLinks && (
            <div
              data-testid="dev-admin-banner"
              className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-md px-3 py-2.5"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 mt-px" />
              <div className="space-y-1">
                <p>
                  <strong>Dev / Admin mode:</strong> File paths, storyboard links, and hosting
                  instructions are visible below. These are hidden for regular users.
                </p>
                <p className="text-amber-400/60">
                  To publish a video: set{" "}
                  <code className="bg-amber-400/10 px-1 rounded">videoUrl</code>,{" "}
                  <code className="bg-amber-400/10 px-1 rounded">hostedProvider</code>, and{" "}
                  <code className="bg-amber-400/10 px-1 rounded">status: &quot;hosted&quot;</code>{" "}
                  in{" "}
                  <code className="bg-amber-400/10 px-1 rounded">
                    client/src/data/training-hub.ts
                  </code>
                  . See{" "}
                  <code className="bg-amber-400/10 px-1 rounded">
                    onboarding-videos/HOSTING.md
                  </code>{" "}
                  for the full guide.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Publishing checklist (admin/demo only) ───────────────────────── */}
        {canSeeDevLinks && <PublishingChecklist />}

        {/* ── Section tabs ──────────────────────────────────────────────────── */}
        <div
          className="flex gap-1 border-b border-border/40"
          data-testid="training-hub-tabs"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              data-testid={`tab-${s.id}`}
              onClick={() => setActiveSection(s.id)}
              className={[
                "px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors",
                activeSection === s.id
                  ? "border-cyan-500 text-cyan-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {s.label}
              {s.id === "library" && hostedCount > 0 && (
                <span className="ml-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded px-1">
                  {hostedCount}/{totalCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── A. Learning Paths ─────────────────────────────────────────────── */}
        {activeSection === "playlists" && (
          <div className="space-y-6" data-testid="section-playlists">
            {selectedPlaylistId ? (
              <PlaylistViewer
                playlistId={selectedPlaylistId}
                canSeeDevLinks={canSeeDevLinks}
                onBack={() => setSelectedPlaylistId(null)}
              />
            ) : (
              <>
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">
                    Role-Based Learning Paths
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Pick your role to get a curated playlist — only the videos that matter to your
                    day-to-day work.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {TRAINING_PLAYLISTS.map((pl) => (
                    <PlaylistCard
                      key={pl.id}
                      playlist={pl}
                      canSeeDevLinks={canSeeDevLinks}
                      onSelect={setSelectedPlaylistId}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── B. Video Library ──────────────────────────────────────────────── */}
        {activeSection === "library" && (
          <div className="space-y-6" data-testid="section-library">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground mb-1">Video Library</h2>
                <p className="text-sm text-muted-foreground">
                  All six walkthroughs in numbered order. Status badges show where each video is in
                  the production pipeline.
                </p>
              </div>

              {/* Status legend */}
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    "hosted",
                    "edited",
                    "raw_recorded",
                    "not_recorded",
                    "needs_update",
                  ] as VideoStatus[]
                ).map((s) => (
                  <StatusBadge key={s} status={s} />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {TRAINING_VIDEOS.map((v) => (
                <VideoRow key={v.id} video={v} canSeeDevLinks={canSeeDevLinks} />
              ))}
            </div>

            {/* "No hosted videos yet" notice for regular users */}
            {!TRAINING_VIDEOS.some((v) => v.status === "hosted") && !canSeeDevLinks && (
              <div className="flex items-start gap-3 bg-muted/20 border border-border/30 rounded-lg px-4 py-3">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-0.5">Videos coming soon</p>
                  <p>
                    Onboarding videos are being recorded and edited. Check back soon — they'll
                    appear here once ready.
                  </p>
                </div>
              </div>
            )}

            {/* Dev notice for admin/demo */}
            {canSeeDevLinks && !TRAINING_VIDEOS.some((v) => v.status === "hosted") && (
              <div className="flex items-start gap-3 bg-muted/20 border border-border/30 rounded-lg px-4 py-3">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-0.5">
                    No hosted videos yet — here's how to publish one
                  </p>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs mt-1">
                    <li>
                      Export a final MP4 to{" "}
                      <code className="bg-muted px-1 rounded">
                        onboarding-videos/outputs/final/[slug].mp4
                      </code>
                    </li>
                    <li>Upload to Vimeo (unlisted) or YouTube (unlisted)</li>
                    <li>
                      Paste the URL into{" "}
                      <code className="bg-muted px-1 rounded">
                        client/src/data/training-hub.ts
                      </code>{" "}
                      and set{" "}
                      <code className="bg-muted px-1 rounded">status: &quot;hosted&quot;</code>
                    </li>
                    <li>
                      Full guide:{" "}
                      <code className="bg-muted px-1 rounded">
                        onboarding-videos/HOSTING.md
                      </code>
                    </li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── C. Coming Soon ────────────────────────────────────────────────── */}
        {activeSection === "future" && (
          <div className="space-y-6" data-testid="section-future">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Coming Soon</h2>
              <p className="text-sm text-muted-foreground">
                These training videos are planned. They'll appear in your playlist automatically
                when recorded.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FUTURE_VIDEOS.map((fv) => (
                <FutureVideoCard
                  key={fv.id}
                  title={fv.title}
                  description={fv.description}
                  targetAudiences={fv.targetAudiences}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
