import { Suspense } from "react"

import { Workspace } from "@/components/workspace"

// Static export: the project id travels in `?p=`, read client-side via
// useSearchParams, which must sit under a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  )
}
