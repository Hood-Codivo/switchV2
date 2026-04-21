// Pure typed wrapper — no Convex imports, no Node-only APIs.

type CreateLiveInputArgs = {
  meta: { name: string }
  recording?: { mode: "automatic" | "off" }
}

type CreateLiveInputResult = {
  uid: string
  rtmpsUrl: string
  streamKey: string
}

type AddLiveOutputArgs = {
  liveInputUid: string
  url: string
  streamKey: string
}

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function baseUrl(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/stream`
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${env("CLOUDFLARE_STREAM_API_TOKEN")}`,
    "Content-Type": "application/json",
  }
}

function getObjectKeys(value: unknown): string[] {
  return value && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : []
}

function summarizeUrl(value: string): Record<string, unknown> {
  try {
    const url = new URL(value)
    return {
      protocol: url.protocol,
      host: url.host,
      pathSegments: url.pathname.split("/").filter(Boolean).length,
      length: value.length,
      parseable: true,
    }
  } catch {
    return {
      startsWithRtmp: value.startsWith("rtmp://") || value.startsWith("rtmps://"),
      length: value.length,
      parseable: false,
    }
  }
}

async function handle<T>(res: Response, ctx: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${ctx} failed: ${res.status} — ${body}`)
  }
  const json = (await res.json()) as { result: T }
  console.info(`[cloudflare-stream] ${ctx} response`, {
    status: res.status,
    resultKeys: getObjectKeys(json.result),
  })
  return json.result
}

export async function createLiveInput(
  args: CreateLiveInputArgs,
): Promise<CreateLiveInputResult> {
  console.info("[cloudflare-stream] createLiveInput request", {
    metaNameLength: args.meta.name.length,
    recordingMode: args.recording?.mode ?? "automatic",
  })
  const res = await fetch(`${baseUrl()}/live_inputs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      meta: args.meta,
      recording: args.recording ?? { mode: "automatic" },
    }),
  })
  const result = await handle<{
    uid: string
    rtmps: { url: string; streamKey: string }
  }>(res, "createLiveInput")
  return {
    uid: result.uid,
    rtmpsUrl: result.rtmps.url,
    streamKey: result.rtmps.streamKey,
  }
}

export async function getLiveInput(liveInputUid: string) {
  console.info("[cloudflare-stream] getLiveInput request", { liveInputUid })
  const res = await fetch(`${baseUrl()}/live_inputs/${liveInputUid}`, {
    headers: headers(),
  })
  return handle<{ uid: string; status: unknown }>(res, "getLiveInput")
}

export async function addLiveOutput(args: AddLiveOutputArgs): Promise<{ uid: string }> {
  console.info("[cloudflare-stream] addLiveOutput request", {
    liveInputUid: args.liveInputUid,
    destination: summarizeUrl(args.url),
    streamKeyLength: args.streamKey.length,
  })
  const res = await fetch(`${baseUrl()}/live_inputs/${args.liveInputUid}/outputs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      url: args.url,
      streamKey: args.streamKey,
      enabled: true,
    }),
  })
  return handle<{ uid: string }>(res, "addLiveOutput")
}

export async function deleteLiveOutput(args: {
  liveInputUid: string
  outputUid: string
}): Promise<void> {
  const res = await fetch(
    `${baseUrl()}/live_inputs/${args.liveInputUid}/outputs/${args.outputUid}`,
    { method: "DELETE", headers: headers() },
  )
  if (res.status === 404) return
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`deleteLiveOutput failed: ${res.status} — ${body}`)
  }
}
