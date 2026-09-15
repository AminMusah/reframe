"use client"

import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { api } from "@/convex/_generated/api"

/**
 * Open the most recent drawing (creating one if none). Used instead of
 * navigating to `/`: on the static export a `router.replace("/")` from
 * `/?p=…` did not take, leaving a blank page.
 */
export function useGoHome() {
  const router = useRouter()
  const openMostRecent = useMutation(api.projects.openMostRecent)
  return React.useCallback(async () => {
    const id = await openMostRecent()
    router.replace(`/?p=${id}`)
  }, [openMostRecent, router])
}
