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

async function handle<T>(res: Response, ctx: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${ctx} failed: ${res.status} — ${body}`)
  }
  const json = (await res.json()) as { result: T }
  return json.result
}

export async function createLiveInput(
  args: CreateLiveInputArgs,
): Promise<CreateLiveInputResult> {
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
  const res = await fetch(`${baseUrl()}/live_inputs/${liveInputUid}`, {
    headers: headers(),
  })
  return handle<{ uid: string; status: unknown }>(res, "getLiveInput")
}

export async function addLiveOutput(args: AddLiveOutputArgs): Promise<{ uid: string }> {
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
