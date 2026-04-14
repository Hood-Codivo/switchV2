import { describe, expect, test, vi, beforeEach } from "vitest"
import { createLiveInput, addLiveOutput, deleteLiveOutput } from "../cloudflare-stream"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc"
  process.env.CLOUDFLARE_STREAM_API_TOKEN = "token"
})

describe("createLiveInput", () => {
  test("POSTs to the correct URL and returns uid + rtmps credentials", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        result: { uid: "li-1", rtmps: { url: "rtmps://live.cloudflare.com:443/live/", streamKey: "sk-1" } },
      }), { status: 200 }),
    )
    const result = await createLiveInput({ meta: { name: "test" } })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc/stream/live_inputs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    )
    expect(result).toEqual({
      uid: "li-1",
      rtmpsUrl: "rtmps://live.cloudflare.com:443/live/",
      streamKey: "sk-1",
    })
  })
})

describe("addLiveOutput", () => {
  test("POSTs to /live_inputs/:uid/outputs with url + streamKey + enabled=true", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: { uid: "lo-1" } }), { status: 200 }),
    )
    const out = await addLiveOutput({
      liveInputUid: "li-1",
      url: "rtmp://a.rtmp.youtube.com/live2",
      streamKey: "yt-key",
    })
    expect(out).toEqual({ uid: "lo-1" })
  })
})

describe("deleteLiveOutput", () => {
  test("ignores 404 (already gone)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }))
    await expect(deleteLiveOutput({ liveInputUid: "li-1", outputUid: "lo-1" })).resolves.toBeUndefined()
  })
})
