import { describe, it, expect } from "vitest"
import { getOptimalLayout } from "./auto-layout"
import type { StageSource } from "./auto-layout"

function camera(id: string, addedAt: number): StageSource {
  return { id, type: "camera", addedAt }
}

describe("getOptimalLayout", () => {
  it("returns solo layout for a single camera", () => {
    const result = getOptimalLayout([camera("host:camera", 1)])

    expect(result!.layoutId).toBe("solo")
    expect(result!.slotAssignments).toEqual(["host:camera"])
  })

  it("returns side-by-side for two cameras, oldest in slot 0", () => {
    const result = getOptimalLayout([
      camera("guest:camera", 200),
      camera("host:camera", 100),
    ])

    expect(result!.layoutId).toBe("side-by-side")
    expect(result!.slotAssignments).toEqual(["host:camera", "guest:camera"])
  })

  it("returns spotlight for three cameras, oldest in slot 0", () => {
    const result = getOptimalLayout([
      camera("guest-b:camera", 300),
      camera("host:camera", 100),
      camera("guest-a:camera", 200),
    ])

    expect(result!.layoutId).toBe("spotlight")
    expect(result!.slotAssignments).toEqual([
      "host:camera",
      "guest-a:camera",
      "guest-b:camera",
    ])
  })

  it("returns grid for four cameras", () => {
    const result = getOptimalLayout([
      camera("d", 400),
      camera("a", 100),
      camera("c", 300),
      camera("b", 200),
    ])

    expect(result!.layoutId).toBe("grid")
    expect(result!.slotAssignments).toEqual(["a", "b", "c", "d"])
  })

  it("returns sidebar-r for five or more cameras", () => {
    const sources = [1, 2, 3, 4, 5].map((n) => camera(`cam-${n}`, n * 100))
    const result = getOptimalLayout(sources)

    expect(result!.layoutId).toBe("sidebar-r")
    expect(result!.slotAssignments[0]).toBe("cam-1")
  })

  it("returns null layout for zero sources", () => {
    const result = getOptimalLayout([])

    expect(result).toBeNull()
  })

  // ─── Screen share priority ─────────────────────────────────────────────

  it("returns pip-br for one screen share + one camera, screen share in slot 0", () => {
    const result = getOptimalLayout([
      camera("host:camera", 100),
      { id: "host:screen", type: "screen", addedAt: 200 },
    ])

    expect(result!.layoutId).toBe("pip-br")
    expect(result!.slotAssignments[0]).toBe("host:screen")
    expect(result!.slotAssignments[1]).toBe("host:camera")
  })

  it("returns fullscreen for one screen share + zero cameras", () => {
    const result = getOptimalLayout([
      { id: "host:screen", type: "screen", addedAt: 100 },
    ])

    expect(result!.layoutId).toBe("fullscreen")
    expect(result!.slotAssignments).toEqual(["host:screen"])
  })

  it("returns spotlight for one screen share + two cameras", () => {
    const result = getOptimalLayout([
      camera("host:camera", 100),
      camera("guest:camera", 200),
      { id: "host:screen", type: "screen", addedAt: 300 },
    ])

    expect(result!.layoutId).toBe("spotlight")
    expect(result!.slotAssignments[0]).toBe("host:screen")
    expect(result!.slotAssignments[1]).toBe("host:camera")
    expect(result!.slotAssignments[2]).toBe("guest:camera")
  })

  it("returns sidebar-r for one screen share + three or more cameras", () => {
    const result = getOptimalLayout([
      camera("a", 100),
      camera("b", 200),
      camera("c", 300),
      { id: "host:screen", type: "screen", addedAt: 400 },
    ])

    expect(result!.layoutId).toBe("sidebar-r")
    expect(result!.slotAssignments[0]).toBe("host:screen")
  })

  it("with two screen shares, latest gets slot 0 and older gets slot 1", () => {
    const result = getOptimalLayout([
      camera("host:camera", 100),
      { id: "first:screen", type: "screen", addedAt: 200 },
      { id: "second:screen", type: "screen", addedAt: 300 },
    ])

    expect(result!.layoutId).toBe("spotlight")
    expect(result!.slotAssignments[0]).toBe("second:screen")
    expect(result!.slotAssignments[1]).toBe("first:screen")
    expect(result!.slotAssignments[2]).toBe("host:camera")
  })

  it("reverts to camera-count layout when screen shares are removed", () => {
    // Simulates the revert: screen share was removed, only cameras remain
    const result = getOptimalLayout([
      camera("host:camera", 100),
      camera("guest:camera", 200),
    ])

    // Should use camera-count mapping, not screen share mapping
    expect(result!.layoutId).toBe("side-by-side")
    expect(result!.slotAssignments[0]).toBe("host:camera")
  })

  // ─── Seniority edge cases ────────────────────────────────────────────────

  it("never promotes a newer camera over an older one in spotlight", () => {
    // Even though newest is passed first, oldest should still be slot 0
    const result = getOptimalLayout([
      camera("newest", 999),
      camera("middle", 500),
      camera("oldest", 1),
    ])

    expect(result!.layoutId).toBe("spotlight")
    expect(result!.slotAssignments[0]).toBe("oldest")
    expect(result!.slotAssignments[1]).toBe("middle")
    expect(result!.slotAssignments[2]).toBe("newest")
  })
})
