import { STUDIO_LAYOUTS } from "./studio-layouts"

export type SourceType = "camera" | "screen"

export type StageSource = {
  id: string
  type: SourceType
  addedAt: number
}

type AutoLayoutResult = {
  layoutId: string
  slotAssignments: (string | null)[]
}

const CAMERA_COUNT_TO_LAYOUT: Record<number, string> = {
  1: "solo",
  2: "side-by-side",
  3: "spotlight",
  4: "grid",
}

const SCREEN_SHARE_CAMERA_COUNT_TO_LAYOUT: Record<number, string> = {
  0: "fullscreen",
  1: "pip-br",
  2: "spotlight",
}

const OVERFLOW_LAYOUT = "sidebar-r"

const LAYOUT_SLOT_COUNTS: Record<string, number> = Object.fromEntries(
  STUDIO_LAYOUTS.map((l) => [l.id, l.slots.length]),
)

function ensureEnoughSlots(layoutId: string, totalSources: number): string {
  const slotCount = LAYOUT_SLOT_COUNTS[layoutId] ?? 1
  if (slotCount >= totalSources) return layoutId
  // Escalate to a layout with more slots
  const escalation = ["solo", "side-by-side", "spotlight", "grid", "sidebar-r"]
  for (const candidate of escalation) {
    if ((LAYOUT_SLOT_COUNTS[candidate] ?? 1) >= totalSources) return candidate
  }
  return OVERFLOW_LAYOUT
}

export function getOptimalLayout(sources: StageSource[]): AutoLayoutResult | null {
  if (sources.length === 0) return null

  const screens = sources.filter((s) => s.type === "screen")
  const cameras = sources.filter((s) => s.type === "camera")

  const hasScreenShare = screens.length > 0

  if (hasScreenShare) {
    const baseLayoutId = SCREEN_SHARE_CAMERA_COUNT_TO_LAYOUT[cameras.length] ?? OVERFLOW_LAYOUT
    const layoutId = ensureEnoughSlots(baseLayoutId, sources.length)
    // Screen shares: latest first (most recent gets slot 0 = biggest)
    const sortedScreens = [...screens].sort((a, b) => b.addedAt - a.addedAt)
    // Cameras: oldest first (seniority)
    const sortedCameras = [...cameras].sort((a, b) => a.addedAt - b.addedAt)
    return {
      layoutId,
      slotAssignments: [...sortedScreens, ...sortedCameras].map((s) => s.id),
    }
  }

  const layoutId = CAMERA_COUNT_TO_LAYOUT[cameras.length] ?? OVERFLOW_LAYOUT
  const sorted = [...cameras].sort((a, b) => a.addedAt - b.addedAt)

  return {
    layoutId,
    slotAssignments: sorted.map((s) => s.id),
  }
}
