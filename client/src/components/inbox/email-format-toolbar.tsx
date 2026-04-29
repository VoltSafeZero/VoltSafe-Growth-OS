/**
 * Rich-text formatting toolbar that lives inside the email reader, to the
 * LEFT of the existing FIT / 100% / Beautiful / Source / Plain tabs.
 *
 * Clicking a button fires a `inbox:format` window event (see
 * inbox-actions-store#dispatchFormat). The compose dialog subscribes to
 * this event ONLY while it's open and applies the formatting to the
 * current textarea selection (markdown-style wrapping). When no compose
 * is open, the parent inbox page intercepts and opens the reply for the
 * currently focused message before re-dispatching.
 */

import { memo, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  RemoveFormatting,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { dispatchFormat, type FormatCommand } from "./inbox-actions-store";

interface ToolbarBtn {
  cmd: FormatCommand;
  label: string;
  shortcut?: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const BUTTONS: ToolbarBtn[] = [
  { cmd: "bold", label: "Bold", shortcut: "⌘B", Icon: Bold },
  { cmd: "italic", label: "Italic", shortcut: "⌘I", Icon: Italic },
  { cmd: "underline", label: "Underline", shortcut: "⌘U", Icon: UnderlineIcon },
  { cmd: "strikethrough", label: "Strikethrough", Icon: Strikethrough },
  { cmd: "bullet-list", label: "Bullet list", Icon: List },
  { cmd: "ordered-list", label: "Numbered list", Icon: ListOrdered },
  // `link` is rendered separately below — it needs a popover to capture the
  // URL before dispatching.
  { cmd: "clear", label: "Clear formatting", Icon: RemoveFormatting },
];

interface EmailFormatToolbarProps {
  /**
   * Called BEFORE the format event is dispatched. The inbox page uses this
   * to open the inline reply if no compose is currently open, so the
   * format keystroke lands on something. May be omitted in contexts where
   * a compose is guaranteed to be open already.
   */
  onBeforeFormat?: () => void;
  className?: string;
}

function EmailFormatToolbarImpl({
  onBeforeFormat,
  className,
}: EmailFormatToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");

  const handleClick = (cmd: FormatCommand, value?: string) => {
    onBeforeFormat?.();
    // Defer to next tick so the compose dialog has a chance to mount and
    // subscribe to the event bus before we fire the format command.
    setTimeout(() => dispatchFormat(cmd, value), 0);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={`flex items-center gap-0.5 rounded-md bg-muted/30 p-0.5 ${className || ""}`}
        data-testid="email-format-toolbar"
        role="toolbar"
        aria-label="Formatting"
      >
        {BUTTONS.slice(0, 4).map(({ cmd, label, shortcut, Icon }) => (
          <Tooltip key={cmd}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => handleClick(cmd)}
                data-testid={`format-${cmd}`}
                aria-label={label}
                className="p-1.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-background/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {label}
              {shortcut && (
                <span className="ml-2 opacity-60 font-mono">{shortcut}</span>
              )}
            </TooltipContent>
          </Tooltip>
        ))}

        <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden="true" />

        {BUTTONS.slice(4, 6).map(({ cmd, label, Icon }) => (
          <Tooltip key={cmd}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => handleClick(cmd)}
                data-testid={`format-${cmd}`}
                aria-label={label}
                className="p-1.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-background/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {label}
            </TooltipContent>
          </Tooltip>
        ))}

        {/* Link — needs a tiny popover so the user can type the URL.
            This same popover is what the "Hyperlink Settings" button on
            the actions toolbar pops, via the InsertLinkPopover wrapper. */}
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="format-link"
                  aria-label="Insert link"
                  className="p-1.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-background/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              Insert link
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            className="w-72 p-3"
            side="bottom"
            align="start"
            data-testid="popover-insert-link"
          >
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Link URL
              </label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://"
                autoFocus
                data-testid="input-link-url"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && linkUrl.trim()) {
                    e.preventDefault();
                    handleClick("link", linkUrl.trim());
                    setLinkOpen(false);
                  }
                }}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLinkOpen(false)}
                  data-testid="button-cancel-link"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!linkUrl.trim()) return;
                    handleClick("link", linkUrl.trim());
                    setLinkOpen(false);
                  }}
                  data-testid="button-insert-link"
                >
                  Insert
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden="true" />

        {BUTTONS.slice(6).map(({ cmd, label, Icon }) => (
          <Tooltip key={cmd}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => handleClick(cmd)}
                data-testid={`format-${cmd}`}
                aria-label={label}
                className="p-1.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-background/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

export const EmailFormatToolbar = memo(EmailFormatToolbarImpl);
