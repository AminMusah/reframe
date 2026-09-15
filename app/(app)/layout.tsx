import { Providers } from "@/components/providers"

/**
 * The workspace: everything under here needs Convex and a signed-in (at
 * least anonymous) user, and waits for both before rendering. Plain pages
 * (privacy) live in the (site) group and skip all of that.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>
}
