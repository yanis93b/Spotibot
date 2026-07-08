"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { cn } from "@/lib/utils"

/**
 * Small inline copy button rendered inside each toast. Copies the toast's
 * title + description to the clipboard and briefly shows a "Copied!" check.
 *
 * Most useful for error (destructive) toasts so the user can paste the full
 * error message when reporting an issue.
 */
function ToastCopyButton({
  text,
  destructive,
}: {
  text: string
  destructive?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts; fall back silently.
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied!" : "Copy"}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
        destructive
          ? "border-muted/40 text-red-200 hover:border-destructive/30 hover:bg-destructive hover:text-destructive-foreground"
          : "border-border bg-transparent text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      {copied ? (
        <>
          <Check className="size-3" aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" aria-hidden />
          Copy
        </>
      )}
    </button>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        // Build the text payload for the copy button: title + description.
        const copyText = [title, description]
          .map((part) =>
            typeof part === "string" ? part : "",
          )
          .filter(Boolean)
          .join("\n")
        const destructive = variant === "destructive"

        return (
          <Toast
            key={id}
            {...props}
            // Error toasts stay visible longer (10s) so the user has time to
            // read the full message and copy it. Default toasts use 5s.
            duration={destructive ? 10000 : 5000}
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {action}
              {copyText && <ToastCopyButton text={copyText} destructive={destructive} />}
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
