import { HostSessionView, GuestSessionView } from "./session-views"

export default async function StudioSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ guestId?: string }>
}) {
  const { sessionId } = await params
  const { guestId } = await searchParams

  if (guestId) {
    return <GuestSessionView sessionId={sessionId} guestId={guestId} />
  }
  return <HostSessionView sessionId={sessionId} />
}
