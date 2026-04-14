import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval(
  "prune stale stream viewers",
  { minutes: 1 },
  internal.streamViewers.pruneStaleViewers,
)

crons.interval(
  "simulcast orphan cleanup",
  { minutes: 5 },
  internal.streams.cleanupOrphanBroadcasts,
)

export default crons
