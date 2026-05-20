"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, Maximize2, Minimize2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DialogPortal, DialogOverlay } from "@/components/ui/dialog"

interface ExpandableDialogContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "className"> {
  /**
   * Classes applied only in popup (collapsed) mode — sizing constraints like
   * max-w, max-h, width. These are replaced by full-screen positioning when
   * the user expands the dialog.
   */
  popupClassName?: string
  /**
   * Classes applied in BOTH popup and expanded modes — overflow behaviour,
   * padding overrides, etc. These persist across the toggle.
   */
  contentClassName?: string
}

/**
 * Drop-in replacement for DialogContent that adds a Maximize / Minimize toggle
 * button in the top-right corner (just to the left of the built-in close ×).
 *
 * When expanded the dialog covers the full viewport; when collapsed it behaves
 * exactly like a standard centered modal.
 *
 * Usage:
 *   <ExpandableDialogContent
 *     popupClassName="max-w-2xl max-h-[90vh]"
 *     contentClassName="overflow-y-auto p-0"
 *   >
 *     ...
 *   </ExpandableDialogContent>
 */
export const ExpandableDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ExpandableDialogContentProps
>(({ popupClassName, contentClassName, children, ...props }, ref) => {
  const [expanded, setExpanded] = React.useState(false)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // Always-on structural classes (mirrors shadcn DialogContent base)
          "fixed z-[300] grid w-full gap-4 border bg-background p-6 shadow-lg duration-200",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          // Persist across both modes (overflow, padding overrides, etc.)
          contentClassName,
          // Mode-specific positioning & sizing
          expanded
            ? "inset-0 max-w-none rounded-none"
            : cn(
                "left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] sm:rounded-lg",
                "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
                "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
                popupClassName,
              ),
        )}
        {...props}
      >
        {children}

        {/* Expand / collapse toggle — sits just left of the close × */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute right-10 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          data-testid="button-toggle-fullscreen"
          title={expanded ? "Collapse to popup" : "Expand to full screen"}
        >
          {expanded
            ? <Minimize2 className="h-4 w-4" />
            : <Maximize2 className="h-4 w-4" />
          }
          <span className="sr-only">{expanded ? "Collapse" : "Expand"}</span>
        </button>

        {/* Standard close button */}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
ExpandableDialogContent.displayName = "ExpandableDialogContent"
