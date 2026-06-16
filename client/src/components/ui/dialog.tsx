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
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const [expanded, setExpanded] = React.useState(false)
  const [dragPos, setDragPos] = React.useState<{ x: number; y: number } | null>(null)
  const dragRef = React.useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null)
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

  const posStyle: React.CSSProperties = expanded
    ? {}
    : dragPos
    ? { left: dragPos.x, top: dragPos.y }
    : {}

  const isCentered = !expanded && !dragPos

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={mergedRef}
        style={posStyle}
        className={cn(
          "fixed z-[300] grid w-full max-w-lg gap-4 border bg-background shadow-lg duration-200",
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
                "resize overflow-auto min-h-[120px] min-w-[280px] max-h-[90dvh]"
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

        {/* Fullscreen toggle button */}
        <button
          type="button"
          onClick={() => { setExpanded(v => !v); setDragPos(null) }}
          className="absolute right-12 top-3 flex items-center justify-center h-8 w-8 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          data-testid="button-toggle-fullscreen"
          title={expanded ? "Restore" : "Expand to full screen"}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="sr-only">{expanded ? "Restore" : "Expand"}</span>
        </button>

        {/* Close button */}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex items-center justify-center w-8 h-8 min-w-[44px] min-h-[44px] -mr-2 -mt-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
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
