import { notFound } from "next/navigation"
import { fetchQuery } from "convex/nextjs"
import { api } from "@/convex/_generated/api"
import { ChannelPageClient } from "./channel-page-client"

type Props = {
  params: Promise<{ username: string }>
}

export default async function ChannelPage({ params }: Props) {
  const { username } = await params
  const data = await fetchQuery(api.follows.getChannelPage, { username })

  if (!data) notFound()

  return <ChannelPageClient initialData={data} />
}
