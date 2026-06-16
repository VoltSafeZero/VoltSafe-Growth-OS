"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { DialogContent } from "@/components/ui/dialog"

interface ExpandableDialogContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "className"> {
  /**
   * Classes applied in popup (collapsed) mode — sizing constraints such as
   * max-w, max-h, width. Passed through as className to DialogContent.
   */
  popupClassName?: string
  /**
   * Classes applied in BOTH popup and expanded modes — overflow, padding, etc.
   * Passed through as className to DialogContent.
   */
  contentClassName?: string
}

/**
 * Thin wrapper around DialogContent kept for backwards-compat.
 * DialogContent now natively supports drag, resize, and fullscreen,
 * so this component simply forwards all props.
 */
export const ExpandableDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ExpandableDialogContentProps
>(({ popupClassName, contentClassName, children, ...props }, ref) => {
  return (
    <DialogContent
      ref={ref}
      className={cn(popupClassName, contentClassName)}
      {...props}
    >
      {children}
    </DialogContent>
  )
})
ExpandableDialogContent.displayName = "ExpandableDialogContent"
