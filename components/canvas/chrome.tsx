"use client"

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { MainMenu, WelcomeScreen } from "@excalidraw/excalidraw"
import {
  Delete02Icon,
  FolderOpenIcon,
  HelpCircleIcon,
  Flowchart01Icon,
  Book02Icon,
  Eraser01Icon,
  Image02Icon,
  Key01Icon,
  Login03Icon,
  Logout03Icon,
  MagicWand01Icon,
  Moon02Icon,
  PencilEdit02Icon,
  SparklesIcon,
  Sun03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { useTheme } from "next-themes"
import { useRouter } from "next/navigation"
import * as React from "react"

import { HelpDialog } from "@/components/help-dialog"
import { KeyDialog } from "@/components/key-dialog"
import { RenameDialog } from "@/components/project-menu"
import { SignInDialog } from "@/components/account-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { authClient } from "@/lib/auth-client"
import { useApiKey } from "@/lib/llm-settings"
import { layoutScene } from "@/lib/edits/layout"
import { measureText } from "@/lib/edits/apply"
import { clearMirror } from "@/lib/scene-store"

const icon = (i: typeof Key01Icon) => (
  <HugeiconsIcon icon={i} strokeWidth={2} size={16} />
)

/**
 * Everything that used to live in the app header, folded into Excalidraw's
 * own menu and welcome screen so the canvas is the whole window.
 */
export type ChromeDialog =
  "rename" | "delete" | "clear" | "key" | "signin" | "help" | null

export function Chrome({
  projectId,
  projectName,
  api: excalidraw,
  dialog,
  setDialog,
  onLoadExample,
}: {
  projectId: Id<"projects">
  projectName: string
  api: React.RefObject<ExcalidrawImperativeAPI | null>
  dialog: ChromeDialog
  setDialog: (d: ChromeDialog) => void
  onLoadExample: () => void
}) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const [apiKey] = useApiKey()
  const user = useQuery(api.auth.getCurrentUser)
  const providers = useQuery(api.auth.providers)
  const remove = useMutation(api.projects.remove)
  const close = () => setDialog(null)
  const anonymous =
    !user || (user as { isAnonymous?: boolean | null }).isAnonymous

  // "?" opens ours; Excalidraw's own help button is hidden.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, [contenteditable]")) return
      // Capture phase, before Excalidraw's own "?" opens its help dialog.
      e.preventDefault()
      e.stopPropagation()
      setDialog("help")
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [setDialog])

  const deleteProject = async () => {
    await remove({ id: projectId })
    clearMirror(projectId)
    router.replace("/")
  }

  return (
    <>
      <MainMenu>
        <MainMenu.Group title={projectName}>
          <MainMenu.Item
            icon={icon(FolderOpenIcon)}
            onSelect={() =>
              excalidraw.current?.toggleSidebar({
                name: "drawings",
                force: true,
              })
            }
          >
            Drawings…
          </MainMenu.Item>
          <MainMenu.Item
            icon={icon(PencilEdit02Icon)}
            onSelect={() => setDialog("rename")}
          >
            Rename
          </MainMenu.Item>
          <MainMenu.Item
            icon={icon(Delete02Icon)}
            onSelect={() => setDialog("delete")}
          >
            Delete drawing…
          </MainMenu.Item>
        </MainMenu.Group>
        <MainMenu.Separator />
        <MainMenu.Item
          icon={icon(Flowchart01Icon)}
          onSelect={() =>
            excalidraw.current?.updateScene({
              appState: { openDialog: { name: "ttd", tab: "mermaid" } },
            })
          }
        >
          Diagram from Mermaid…
        </MainMenu.Item>
        <MainMenu.Item
          icon={icon(Book02Icon)}
          onSelect={() =>
            excalidraw.current?.toggleSidebar({
              name: "default",
              tab: "library",
              force: true,
            })
          }
        >
          Shape library
        </MainMenu.Item>
        <MainMenu.Item
          icon={icon(MagicWand01Icon)}
          onSelect={async () => {
            const api = excalidraw.current
            if (!api) return
            // Copies: the pass mutates in place; the scene gets the result as
            // one undoable step.
            const elements = api
              .getSceneElements()
              .map((el) => ({ ...el }) as ExcalidrawElement)
            if (layoutScene(elements, measureText).length === 0) return
            const { CaptureUpdateAction } =
              await import("@excalidraw/excalidraw")
            api.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            })
            void api.setViewport({
              target: api.getSceneElements(),
              fit: "scale-down",
              animation: true,
              offsets: { ui: true },
            })
          }}
        >
          Tidy up the drawing
        </MainMenu.Item>
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.Item
          icon={icon(Eraser01Icon)}
          onSelect={() => setDialog("clear")}
        >
          Clear the canvas…
        </MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.Item icon={icon(Key01Icon)} onSelect={() => setDialog("key")}>
          {apiKey ? "Model & API key" : "Add an API key…"}
        </MainMenu.Item>
        <MainMenu.Item
          icon={icon(resolvedTheme === "dark" ? Sun03Icon : Moon02Icon)}
          onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </MainMenu.Item>
        {anonymous
          ? (providers?.length ?? 0) > 0 && (
              <MainMenu.Item
                icon={icon(Login03Icon)}
                onSelect={() => setDialog("signin")}
              >
                Sign in…
              </MainMenu.Item>
            )
          : user && (
              <MainMenu.Item
                icon={icon(Logout03Icon)}
                onSelect={async () => {
                  await authClient.signOut()
                  await authClient.signIn.anonymous()
                }}
              >
                Sign out ({user.name || user.email})
              </MainMenu.Item>
            )}
        <MainMenu.Separator />
        <MainMenu.Item
          icon={icon(HelpCircleIcon)}
          shortcut="?"
          onSelect={() => setDialog("help")}
        >
          Keyboard shortcuts
        </MainMenu.Item>
      </MainMenu>

      <WelcomeScreen>
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Logo>
            <span className="flex items-center gap-2 font-sans text-2xl font-semibold tracking-tight text-foreground">
              <span
                aria-hidden
                className="inline-block size-4 rounded-[5px] bg-brand"
              />
              Reframe
            </span>
          </WelcomeScreen.Center.Logo>
          <WelcomeScreen.Center.Heading>
            Draw what you&apos;re building. Answer a few questions. Get a prompt
            your coding agent can build from.
          </WelcomeScreen.Center.Heading>
          <WelcomeScreen.Center.Menu>
            <WelcomeScreen.Center.MenuItem
              icon={icon(Image02Icon)}
              onSelect={onLoadExample}
            >
              Load an example drawing
            </WelcomeScreen.Center.MenuItem>
            <WelcomeScreen.Center.MenuItem
              icon={icon(SparklesIcon)}
              onSelect={() =>
                excalidraw.current?.toggleSidebar({
                  name: "reframe",
                  force: true,
                })
              }
            >
              How it works
            </WelcomeScreen.Center.MenuItem>
            <WelcomeScreen.Center.MenuItem
              icon={icon(HelpCircleIcon)}
              shortcut="?"
              onSelect={() => setDialog("help")}
            >
              Keyboard shortcuts
            </WelcomeScreen.Center.MenuItem>
          </WelcomeScreen.Center.Menu>
        </WelcomeScreen.Center>
        <WelcomeScreen.Hints.ToolbarHint>
          Draw, or paste a screenshot
        </WelcomeScreen.Hints.ToolbarHint>
        <WelcomeScreen.Hints.MenuHint>
          Drawings, export, your model &amp; key
        </WelcomeScreen.Hints.MenuHint>
      </WelcomeScreen>

      <RenameDialog
        key={`${projectId}:${projectName}`}
        open={dialog === "rename"}
        onOpenChange={(o) => !o && close()}
        projectId={projectId}
        initialName={projectName}
      />
      <KeyDialog open={dialog === "key"} onOpenChange={(o) => !o && close()} />
      <HelpDialog
        open={dialog === "help"}
        onOpenChange={(o) => !o && close()}
      />
      <SignInDialog
        open={dialog === "signin"}
        onOpenChange={(o) => !o && close()}
      />
      <AlertDialog
        open={dialog === "clear"}
        onOpenChange={(o) => !o && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything drawn in “{projectName}” is removed. Undo cannot bring
              it back, but the drawing itself stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                excalidraw.current?.resetScene()
                close()
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{projectName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The drawing, its interviews and prompts are removed for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                close()
                void deleteProject()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
