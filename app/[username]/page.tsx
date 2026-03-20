import { notFound } from "next/navigation"
import { fetchQuery } from "convex/nextjs"
import { api } from "@/convex/_generated/api"
import { ChannelPageClient } from "./channel-page-client"

type Props = {
  params: Promise<{ username: string }>
}

export default async function ChannelPage({ params }: Props) {
  const { username } = await params
  const [data, stream] = await Promise.all([
    fetchQuery(api.follows.getChannelPage, { username }),
    fetchQuery(api.streams.getByUsername, { username }),
  ])

  if (!data) notFound()

  return <ChannelPageClient initialData={data} initialStream={stream ?? null} />
}
