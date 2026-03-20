import { GuestJoinView } from "@/components/studio/guest-join-view"

export default async function GuestJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <GuestJoinView token={token} />
}
