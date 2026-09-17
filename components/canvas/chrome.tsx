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
  MagicWand01Icon,
  PencilEdit02Icon,
  Copy02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { HelpDialog } from "@/components/help-dialog"
import { Logo } from "@/components/logo"
import { KeyDialog } from "@/components/key-dialog"
import { RenameDialog } from "@/components/project-menu"
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
import { layoutScene } from "@/lib/edits/layout"
import { measureText } from "@/lib/edits/apply"
import { useGoHome } from "@/hooks/use-go-home"
import { PANEL, requestGenerate } from "@/lib/panel"
import { clearMirror, writeMirror } from "@/lib/scene-store"

const icon = (i: typeof Copy02Icon) => (
  <HugeiconsIcon icon={i} strokeWidth={2} size={16} />
)

/**
 * Everything that used to live in the app header, folded into Excalidraw's
 * own menu and welcome screen so the canvas is the whole window.
 */
export type ChromeDialog = "rename" | "delete" | "clear" | "key" | "help" | null

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
  const goHome = useGoHome()
  const router = useRouter()
  const remove = useMutation(api.projects.remove)
  const create = useMutation(api.projects.create)
  const close = () => setDialog(null)

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
    // ⌘/Ctrl+Enter from the canvas: Generate prompt.
    const onGenerate = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, [contenteditable]")) return
      e.preventDefault()
      e.stopPropagation()
      excalidraw.current?.toggleSidebar({ name: PANEL, force: true })
      requestGenerate()
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("keydown", onGenerate, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keydown", onGenerate, true)
    }
  }, [setDialog, excalidraw])

  const deleteProject = async () => {
    await remove({ id: projectId })
    clearMirror(projectId)
    await goHome()
  }

  // A copy: a new drawing seeded with this scene through the mirror, so the
  // first autosave uploads its own file (storage files are shared by nothing).
  const duplicateProject = async () => {
    const api = excalidraw.current
    if (!api) return
    const { serializeAsJSON } = await import("@excalidraw/excalidraw")
    const json = serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
      "local"
    )
    const id = await create({ name: `${projectName} copy` })
    writeMirror(id, { json, sceneHash: "", dirty: true, savedAt: Date.now() })
    router.push(`/?p=${id}`)
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
            icon={icon(Copy02Icon)}
            onSelect={() => void duplicateProject()}
          >
            Duplicate drawing
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
              <Logo className="size-6 text-brand" />
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
