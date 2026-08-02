"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, Maximize2, Minimize2, GripHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[300] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { onExpand?: () => void }
>(({ className, children, onExpand, ...props }, ref) => {
  const [expanded, setExpanded] = React.useState(false)
  const [dragPos, setDragPos] = React.useState<{ x: number; y: number } | null>(null)
  const [resizeSize, setResizeSize] = React.useState<{ w: number | null; h: number | null }>({ w: null, h: null })
  const dragRef = React.useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null)
  const resizeRef = React.useRef<{ mx: number; my: number; ow: number; oh: number } | null>(null)
  const innerRef = React.useRef<HTMLDivElement | null>(null)

  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    },
    [ref]
  )

  const handleDragMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (expanded) return
      if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role="button"],[role="combobox"]')) return
      e.preventDefault()
      const el = innerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = dragPos?.x ?? rect.left + rect.width / 2
      const cy = dragPos?.y ?? rect.top + rect.height / 2
      dragRef.current = { mx: e.clientX, my: e.clientY, ox: cx, oy: cy }

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        setDragPos({
          x: dragRef.current.ox + (ev.clientX - dragRef.current.mx),
          y: dragRef.current.oy + (ev.clientY - dragRef.current.my),
        })
      }
      const onUp = () => {
        dragRef.current = null
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [expanded, dragPos]
  )

  const handleResizeMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (expanded) return
      e.preventDefault()
      e.stopPropagation()
      const el = innerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const startW = resizeSize.w ?? rect.width
      const startH = resizeSize.h ?? rect.height
      resizeRef.current = { mx: e.clientX, my: e.clientY, ow: startW, oh: startH }

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return
        const newW = Math.min(
          window.innerWidth * 0.96,
          Math.max(480, resizeRef.current.ow + (ev.clientX - resizeRef.current.mx))
        )
        const newH = Math.min(
          window.innerHeight * 0.92,
          Math.max(400, resizeRef.current.oh + (ev.clientY - resizeRef.current.my))
        )
        setResizeSize({ w: newW, h: newH })
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [expanded, resizeSize]
  )

  const isResized = resizeSize.w != null || resizeSize.h != null

  const posStyle: React.CSSProperties = expanded
    ? {}
    : {
        ...(dragPos ? { left: dragPos.x, top: dragPos.y } : {}),
        ...(resizeSize.w != null ? { width: resizeSize.w } : {}),
        ...(resizeSize.h != null ? { height: resizeSize.h, maxHeight: "none" } : {}),
      }

  const isCentered = !expanded && !dragPos

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={mergedRef}
        style={posStyle}
        className={cn(
          "fixed z-[300] grid w-full max-w-lg max-w-[calc(100vw-2rem)] gap-4 border bg-background shadow-lg duration-200",
          "overflow-x-hidden break-words [overflow-wrap:anywhere]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          expanded
            ? "inset-0 max-w-none rounded-none p-6 overflow-y-auto"
            : cn(
                "p-6 sm:rounded-lg",
                "-translate-x-1/2 -translate-y-1/2",
                isCentered
                  ? "left-[50%] top-[50%] data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
                  : "",
                "min-h-[120px] min-w-[280px] max-h-[90dvh]",
                "overflow-y-auto"
              ),
          className
        )}
        {...props}
      >
        {/* Drag handle — thin top strip; doesn't intercept interactive children */}
        {!expanded && (
          <div
            className="absolute inset-x-0 top-0 h-8 z-10 select-none cursor-grab active:cursor-grabbing flex items-center justify-center"
            onMouseDown={handleDragMouseDown}
            data-testid="dialog-drag-handle"
            title="Drag to move"
          >
            <GripHorizontal className="h-3 w-4 opacity-20 pointer-events-none" />
          </div>
        )}

        {children}

        {/* Fullscreen toggle button — z-[11] places it above the z-10 drag handle */}
        {/* When onExpand is provided (record drawers), clicking navigates to the full-page  */}
        {/* profile route instead of toggling the CSS fullscreen mode.                       */}
        <button
          type="button"
          data-no-drag
          onClick={() => {
            if (onExpand) { onExpand(); return; }
            setExpanded(v => !v); setDragPos(null);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-12 top-3 z-[11] flex items-center justify-center h-8 w-8 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
          data-testid="button-toggle-fullscreen"
          title={onExpand ? "Open full profile" : (expanded ? "Restore" : "Expand to full screen")}
        >
          <Maximize2 className="h-4 w-4" />
          <span className="sr-only">{onExpand ? "Open full profile" : (expanded ? "Restore" : "Expand")}</span>
        </button>

        {/* Close button — z-[11] places it above the z-10 drag handle */}
        <DialogPrimitive.Close
          data-no-drag
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-3 top-3 z-[11] flex items-center justify-center w-8 h-8 min-w-[44px] min-h-[44px] -mr-2 -mt-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground cursor-pointer"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>

        {/* Resize corner handle — bottom-right grip */}
        {!expanded && (
          <div
            className="absolute bottom-0 right-0 w-5 h-5 z-[11] cursor-se-resize select-none flex items-end justify-end pb-0.5 pr-0.5"
            onMouseDown={handleResizeMouseDown}
            data-testid="dialog-resize-handle"
            title="Drag to resize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-30">
              <path d="M9 1L1 9M9 5L5 9M9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
