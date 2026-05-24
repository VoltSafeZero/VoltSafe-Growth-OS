/**
 * Rich-text formatting toolbar for the email composer.
 *
 * Clicking a button fires an `inbox:format` window event
 * (see inbox-actions-store#dispatchFormat). The compose dialog subscribes
 * while open and applies the formatting to the contenteditable editor via
 * document.execCommand. When no compose is open, the parent inbox page
 * intercepts and opens the inline reply first.
 *
 * Link flow:
 *   1. User highlights text in the editor.
 *   2. User clicks the Link button — onBeforeLinkOpen() fires so the compose
 *      dialog can save the current Selection before focus moves.
 *   3. Popover opens; user types a URL (bare domains are normalised to https://).
 *   4. On confirm, the URL is dispatched via the format bus and the compose
 *      dialog restores the saved selection before calling createLink.
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
import { normalizeUrl } from "@/lib/email-format";

interface ToolbarBtn {
  cmd: FormatCommand;
  label: string;
  shortcut?: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const BUTTONS: ToolbarBtn[] = [
  { cmd: "bold",          label: "Bold",             shortcut: "⌘B", Icon: Bold },
  { cmd: "italic",        label: "Italic",           shortcut: "⌘I", Icon: Italic },
  { cmd: "underline",     label: "Underline",        shortcut: "⌘U", Icon: UnderlineIcon },
  { cmd: "strikethrough", label: "Strikethrough",                    Icon: Strikethrough },
  { cmd: "bullet-list",   label: "Bullet list",                      Icon: List },
  { cmd: "ordered-list",  label: "Numbered list",                    Icon: ListOrdered },
  // `link` rendered separately — needs a popover to capture the URL first
  { cmd: "clear",         label: "Clear formatting",                 Icon: RemoveFormatting },
];

interface EmailFormatToolbarProps {
  /**
   * Called BEFORE the format event is dispatched. The inbox page uses this
   * to open the inline reply if no compose is currently open.
   */
  onBeforeFormat?: () => void;
  /**
   * Called immediately when the link popover opens — BEFORE focus moves to
   * the URL input. The compose dialog uses this to save the current
   * Selection so it can be restored when createLink is executed.
   */
  onBeforeLinkOpen?: () => void;
  className?: string;
}

function EmailFormatToolbarImpl({
  onBeforeFormat,
  onBeforeLinkOpen,
  className,
}: EmailFormatToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const handleClick = (cmd: FormatCommand, value?: string) => {
    onBeforeFormat?.();
    setTimeout(() => dispatchFormat(cmd, value), 0);
  };

  const handleInsertLink = () => {
    const normalized = normalizeUrl(linkUrl);
    if (!normalized) return;
    handleClick("link", normalized);
    setLinkOpen(false);
    setLinkUrl("");
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

        {/* Link — needs a popover to capture the URL before dispatching */}
        <Popover
          open={linkOpen}
          onOpenChange={(open) => {
            if (open) {
              // Save the selection BEFORE focus leaves the editor
              onBeforeLinkOpen?.();
              setLinkUrl("");
            }
            setLinkOpen(open);
          }}
        >
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
                placeholder="https://example.com or example.com"
                autoFocus
                data-testid="input-link-url"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleInsertLink();
                  }
                }}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setLinkOpen(false); setLinkUrl(""); }}
                  data-testid="button-cancel-link"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleInsertLink}
                  disabled={!linkUrl.trim()}
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
