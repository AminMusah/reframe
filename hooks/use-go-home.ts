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
    try {
      const id = await openMostRecent()
      router.replace(`/?p=${id}`)
    } catch (err) {
      // Between a sign-out or account deletion and the next anonymous
      // session there is a moment with no identity; a fresh load sorts it.
      if (String(err).includes("Unauthenticated")) window.location.replace("/")
      else throw err
    }
  }, [openMostRecent, router])
}
