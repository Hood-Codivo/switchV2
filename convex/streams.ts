import { v } from "convex/values"
import { query } from "./_generated/server"
import { categoryValidator } from "./schema"

export const listLiveStreams = query({
  args: {
    category: v.union(categoryValidator, v.null()),
    searchQuery: v.string(),
  },
  handler: async (ctx, { category, searchQuery }) => {
    const liveStreams = await ctx.db
      .query("streams")
      .withIndex("by_is_live_and_viewer_count", (q) => q.eq("isLive", true))
      .order("desc")
      .collect()

    const filtered = liveStreams.filter((stream) => {
      if (category && stream.category !== category) return false
      return true
    })

    // Fetch each unique creator once — avoids redundant db.get calls when
    // multiple streams share the same creator.
    const uniqueCreatorIds = [...new Set(filtered.map((s) => s.creatorId))]
    const creators = await Promise.all(uniqueCreatorIds.map((id) => ctx.db.get(id)))
    const creatorById = new Map(uniqueCreatorIds.map((id, i) => [id, creators[i]]))

    const results = filtered.map((stream) => ({
      stream,
      creator: creatorById.get(stream.creatorId) ?? null,
    }))

    if (!searchQuery) return results

    const q = searchQuery.toLowerCase()
    return results.filter(
      ({ stream, creator }) =>
        stream.title.toLowerCase().startsWith(q) ||
        (creator?.username ?? "").toLowerCase().startsWith(q),
    )
  },
})
