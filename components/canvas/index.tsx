"use client"

import dynamic from "next/dynamic"

// Excalidraw touches window at import time; load it client-side only.
export const Canvas = dynamic(() => import("./excalidraw-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading canvas…
    </div>
  ),
})

export type { CanvasProps } from "./excalidraw-canvas"
