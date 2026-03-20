// Slot geometry is expressed as fractions of the 1280×720 canvas.
// The compositor multiplies these by the canvas dimensions on every rAF frame.

export type LayoutSlot = { x: number; y: number; w: number; h: number }

export type LayoutConfig = {
  id: string
  label: string
  slots: LayoutSlot[]
}

export const STUDIO_LAYOUTS: LayoutConfig[] = [
  {
    id: "solo",
    label: "Solo",
    slots: [{ x: 0, y: 0, w: 1, h: 1 }],
  },
  {
    id: "side-by-side",
    label: "Side by side",
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: "spotlight",
    label: "Spotlight",
    slots: [
      { x: 0, y: 0, w: 0.75, h: 1 },
      { x: 0.75, y: 0, w: 0.25, h: 0.5 },
      { x: 0.75, y: 0.5, w: 0.25, h: 0.5 },
    ],
  },
  {
    id: "grid",
    label: "Grid",
    slots: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: "pip-br",
    label: "PiP Bottom Right",
    slots: [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.7, y: 0.65, w: 0.28, h: 0.32 },
    ],
  },
  {
    id: "pip-bl",
    label: "PiP Bottom Left",
    slots: [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.02, y: 0.65, w: 0.28, h: 0.32 },
    ],
  },
  {
    id: "sidebar-r",
    label: "Sidebar Right",
    slots: [
      { x: 0, y: 0, w: 0.65, h: 1 },
      { x: 0.67, y: 0, w: 0.33, h: 0.333 },
      { x: 0.67, y: 0.333, w: 0.33, h: 0.333 },
      { x: 0.67, y: 0.667, w: 0.33, h: 0.333 },
    ],
  },
  {
    id: "fullscreen",
    label: "Fullscreen",
    slots: [{ x: 0, y: 0, w: 1, h: 1 }],
  },
]

export const DEFAULT_LAYOUT_ID = "side-by-side"

export const STUDIO_LAYOUT_MAP = Object.fromEntries(STUDIO_LAYOUTS.map((l) => [l.id, l]))
