"use client"

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import * as React from "react"
import { Streamdown } from "streamdown"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Plain text of a rendered markdown node (a fence's contents). */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string") return node
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children)
  }
  return ""
}

/** A fenced block: mono text on the muted surface, a language tag and Copy. No highlighting — the design has no colour to spend. */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="my-3 overflow-hidden rounded-lg bg-muted first:mt-0 last:mb-0">
      <div className="flex h-8 items-center justify-between pr-1 pl-3">
        <span className="font-mono text-[11px] text-muted-foreground">
          {language ?? "code"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label="Copy code"
          onClick={async () => {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </Button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-[0.8rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

type P<T extends keyof React.JSX.IntrinsicElements> =
  React.JSX.IntrinsicElements[T] & { node?: unknown }

/**
 * Hoisted to module scope on purpose: defined inline, every render would
 * mint new component identities, and React would remount the whole markdown
 * tree on each streamed flush.
 */
const components: React.ComponentProps<typeof Streamdown>["components"] = {
  p: ({ className, node: _n, ...props }: P<"p">) => (
    <p className={cn("my-2 first:mt-0 last:mb-0", className)} {...props} />
  ),
  h1: ({ className, node: _n, ...props }: P<"h1">) => (
    <h2
      className={cn(
        "mt-5 mb-1.5 text-[1.05rem] leading-tight font-semibold tracking-tight first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h2: ({ className, node: _n, ...props }: P<"h2">) => (
    <h3
      className={cn(
        "mt-5 mb-1.5 text-[0.95rem] leading-tight font-semibold tracking-tight first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h3: ({ className, node: _n, ...props }: P<"h3">) => (
    <h4
      className={cn(
        "mt-4 mb-1 text-sm leading-tight font-semibold tracking-tight first:mt-0",
        className
      )}
      {...props}
    />
  ),
  h4: ({ className, node: _n, ...props }: P<"h4">) => (
    <h4
      className={cn("mt-4 mb-1 text-sm font-semibold first:mt-0", className)}
      {...props}
    />
  ),
  ul: ({ className, node: _n, ...props }: P<"ul">) => (
    <ul
      className={cn(
        "my-2 ml-5 list-disc space-y-1 first:mt-0 last:mb-0",
        className
      )}
      {...props}
    />
  ),
  ol: ({ className, node: _n, ...props }: P<"ol">) => (
    <ol
      className={cn(
        "my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0",
        className
      )}
      {...props}
    />
  ),
  li: ({ className, node: _n, ...props }: P<"li">) => (
    <li className={cn("[&>p]:my-0", className)} {...props} />
  ),
  a: ({ className, node: _n, ...props }: P<"a">) => (
    <a
      target="_blank"
      rel="noreferrer"
      className={cn("underline underline-offset-2", className)}
      {...props}
    />
  ),
  strong: ({ className, node: _n, ...props }: P<"strong">) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  blockquote: ({ className, node: _n, ...props }: P<"blockquote">) => (
    <blockquote
      className={cn(
        "my-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground [&>p]:my-0",
        className
      )}
      {...props}
    />
  ),
  hr: ({ className, node: _n, ...props }: P<"hr">) => (
    <hr
      className={cn("my-4 border-0 border-t border-muted", className)}
      {...props}
    />
  ),
  table: ({ className, node: _n, ...props }: P<"table">) => (
    <div className="my-2 overflow-x-auto rounded-lg bg-muted first:mt-0 last:mb-0">
      <table
        className={cn("w-full border-collapse text-[0.85em]", className)}
        {...props}
      />
    </div>
  ),
  th: ({ className, node: _n, ...props }: P<"th">) => (
    <th
      className={cn("px-2.5 py-1.5 text-left font-semibold", className)}
      {...props}
    />
  ),
  td: ({ className, node: _n, ...props }: P<"td">) => (
    <td
      className={cn("border-t border-background/60 px-2.5 py-1.5", className)}
      {...props}
    />
  ),
  // Inline code and fences both land here; only a fence carries a language.
  code: ({ className, children, node: _n, ...props }: P<"code">) => {
    const language = /language-(\w+)/.exec(className ?? "")?.[1]
    if (!language) {
      return (
        <code
          className={cn(
            "rounded-[0.3em] bg-muted px-[0.35em] py-[0.1em] font-mono text-[0.85em]",
            className
          )}
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <CodeBlock
        code={textOf(children).replace(/\n$/, "")}
        language={language}
      />
    )
  },
  // CodeBlock owns its container; drop the outer <pre>.
  pre: ({ children }: P<"pre">) => <>{children}</>,
}

/**
 * Markdown for streamed text. Streamdown parses (GFM, per-block memo) and
 * closes unterminated emphasis and fences mid-stream; our `components` map
 * dresses the output in the app's tokens instead of its bundled look.
 */
export function Markdown({
  children,
  streaming = false,
  className,
}: {
  children: string
  streaming?: boolean
  className?: string
}) {
  return (
    <Streamdown
      parseIncompleteMarkdown
      isAnimating={streaming}
      controls={false}
      className={cn("text-sm", className)}
      components={components}
    >
      {children}
    </Streamdown>
  )
}
