import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  GraduationCap, PlayCircle, Clock, Users, ChevronRight,
  BookOpen, Lock, ExternalLink, FileText, Sparkles,
} from "lucide-react";
import { isDemoModeActive } from "@/lib/demo-mode";
import {
  TRAINING_PLAYLISTS,
  TRAINING_VIDEOS,
  FUTURE_VIDEOS,
  type TrainingPlaylist,
  type TrainingVideo,
} from "@/data/training-hub";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdminRole(role: string | undefined) {
  return role === "admin" || role === "master_admin";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PlaylistCard({ playlist, canSeeDevLinks }: { playlist: TrainingPlaylist; canSeeDevLinks: boolean }) {
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

        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <Button
            data-testid={`button-view-playlist-${playlist.id}`}
            size="sm"
            className="bg-cyan-600 hover:bg-cyan-500 text-white flex-1"
            onClick={() => {
              // Playlists are markdown docs — show the file path clearly
              // Replace with a hosted URL when available
              window.open(`https://github.com/search?q=${encodeURIComponent(playlist.filePath)}`, "_blank", "noopener");
            }}
          >
            View Playlist <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
          {canSeeDevLinks && (
            <Button
              data-testid={`button-storyboard-path-${playlist.id}`}
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground text-[11px] px-2"
              title={playlist.filePath}
              onClick={() => navigator.clipboard?.writeText(playlist.filePath).catch(() => {})}
            >
              <FileText className="h-3 w-3" />
            </Button>
          )}
        </div>

        {canSeeDevLinks && (
          <p className="text-[10px] text-muted-foreground/60 font-mono break-all leading-tight">
            {playlist.filePath}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function VideoRow({ video, canSeeDevLinks }: { video: TrainingVideo; canSeeDevLinks: boolean }) {
  const hasVideo = !!video.videoUrl;
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
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground">
            <Clock className="h-2.5 w-2.5 mr-1" />{video.duration}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-2">{video.description}</p>
        <div className="flex flex-wrap gap-1">
          {video.audiences.map((a) => (
            <Badge key={a} className="text-[10px] px-1.5 py-0 bg-muted/60 text-muted-foreground border-0">
              {a}
            </Badge>
          ))}
        </div>
        {canSeeDevLinks && (
          <p className="text-[10px] text-muted-foreground/50 font-mono mt-1.5 break-all leading-tight">
            {video.storyboardPath}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-col gap-1.5 items-end">
        {hasVideo ? (
          <Button
            data-testid={`button-watch-${video.id}`}
            size="sm"
            className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs whitespace-nowrap"
            onClick={() => window.open(video.videoUrl!, "_blank", "noopener")}
          >
            <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
            Watch Video
          </Button>
        ) : (
          <Button
            data-testid={`button-watch-${video.id}`}
            size="sm"
            variant="outline"
            disabled
            className="text-xs whitespace-nowrap border-border/40 text-muted-foreground"
          >
            <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
            Watch Video
          </Button>
        )}
        {canSeeDevLinks && (
          <Button
            data-testid={`button-storyboard-${video.id}`}
            size="sm"
            variant="ghost"
            className="text-[11px] text-muted-foreground hover:text-cyan-400 whitespace-nowrap px-2"
            onClick={() => navigator.clipboard?.writeText(video.storyboardPath).catch(() => {})}
            title={`Storyboard: ${video.storyboardPath}`}
          >
            <BookOpen className="h-3 w-3 mr-1" />
            Storyboard
          </Button>
        )}
      </div>
    </div>
  );
}

function FutureVideoCard({ title, description, targetAudiences }: {
  title: string;
  description: string;
  targetAudiences: string[];
}) {
  return (
    <div
      data-testid={`future-video-${title.toLowerCase().replace(/\s+/g, "-")}`}
      className="flex flex-col gap-2 p-4 rounded-lg border border-dashed border-border/30 bg-muted/10"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/40 text-muted-foreground/60 shrink-0">
          Coming soon
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground/60 leading-relaxed">{description}</p>
      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {targetAudiences.map((a) => (
          <span key={a} className="text-[10px] text-muted-foreground/50 bg-muted/30 rounded px-1.5 py-0.5">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TrainingHubPage() {
  const [activeSection, setActiveSection] = useState<"playlists" | "library" | "future">("playlists");

  const { data: user } = useQuery<{ globalRole?: string; name?: string }>({
    queryKey: ["/api/auth/me"],
  });

  const canSeeDevLinks = isDemoModeActive() || isAdminRole(user?.globalRole);

  const sections = [
    { id: "playlists", label: "Learning Paths" },
    { id: "library",   label: "Video Library" },
    { id: "future",    label: "Coming Soon" },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-10">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <GraduationCap className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground leading-tight" data-testid="training-hub-title">
                VoltSafe CMS Training Hub
              </h1>
              <p className="text-xs text-muted-foreground">
                Role-based walkthroughs, onboarding videos, and workflow guides
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Learn how to use VoltSafe CMS through role-based walkthroughs, onboarding videos, and workflow guides.
            Pick your role below to find the right learning path — or browse the full video library.
          </p>

          {canSeeDevLinks && (
            <div className="flex items-center gap-2 text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-md px-3 py-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>Dev / Admin mode:</strong> Storyboard file paths and internal links are visible below.
                These are hidden for regular users.
              </span>
            </div>
          )}
        </div>

        {/* ── Section tabs ────────────────────────────────────────────────── */}
        <div className="flex gap-1 border-b border-border/40 pb-0" data-testid="training-hub-tabs">
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
            </button>
          ))}
        </div>

        {/* ── A. Learning Paths / Playlists ───────────────────────────────── */}
        {activeSection === "playlists" && (
          <div className="space-y-6" data-testid="section-playlists">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Role-Based Learning Paths</h2>
              <p className="text-sm text-muted-foreground">
                Pick your role to get a curated playlist — only the videos that matter to your day-to-day work.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TRAINING_PLAYLISTS.map((pl) => (
                <PlaylistCard key={pl.id} playlist={pl} canSeeDevLinks={canSeeDevLinks} />
              ))}
            </div>

            {canSeeDevLinks && (
              <div className="text-xs text-muted-foreground/60 bg-muted/20 rounded-lg p-3 border border-border/30 space-y-1">
                <p className="font-medium text-muted-foreground">Dev: playlist file paths</p>
                {TRAINING_PLAYLISTS.map((pl) => (
                  <p key={pl.id} className="font-mono">{pl.filePath}</p>
                ))}
                <p className="font-mono">onboarding-videos/PLAYLISTS.md</p>
              </div>
            )}
          </div>
        )}

        {/* ── B. Video Library ────────────────────────────────────────────── */}
        {activeSection === "library" && (
          <div className="space-y-6" data-testid="section-library">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Video Library</h2>
              <p className="text-sm text-muted-foreground">
                All six walkthroughs in numbered order. Watch individually or follow a playlist for your role.
              </p>
            </div>

            <div className="space-y-3">
              {TRAINING_VIDEOS.map((v) => (
                <VideoRow key={v.id} video={v} canSeeDevLinks={canSeeDevLinks} />
              ))}
            </div>

            {!TRAINING_VIDEOS.some((v) => v.videoUrl) && (
              <div className="flex items-start gap-3 bg-muted/20 border border-border/30 rounded-lg px-4 py-3">
                <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-0.5">Hosted links not set up yet</p>
                  <p>
                    Videos are recorded in{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">onboarding-videos/outputs/raw/</code>.
                    Import them into Descript or Screen Studio, add voiceover, then host on Vimeo or YouTube
                    and update <code className="text-xs bg-muted px-1 py-0.5 rounded">videoUrl</code> in{" "}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">client/src/data/training-hub.ts</code>.
                  </p>
                  {canSeeDevLinks && (
                    <p className="mt-1.5 text-xs font-mono text-muted-foreground/60">
                      Raw recordings: onboarding-videos/outputs/raw/*.webm
                    </p>
                  )}
                </div>
              </div>
            )}

            {canSeeDevLinks && (
              <div className="flex items-start gap-3 bg-muted/20 border border-border/30 rounded-lg px-4 py-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-sm text-foreground">Dev: storyboard paths</p>
                  {TRAINING_VIDEOS.map((v) => (
                    <p key={v.id} className="font-mono">{v.storyboardPath}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── C. Coming Soon ──────────────────────────────────────────────── */}
        {activeSection === "future" && (
          <div className="space-y-6" data-testid="section-future">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">Coming Soon</h2>
              <p className="text-sm text-muted-foreground">
                These training videos are planned. They'll appear in your playlist automatically when recorded.
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
