import type { QueryCtx, MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

/**
 * Resolves the authenticated Privy user to a Convex user ID.
 *
 * Extracts the Privy DID from the JWT identity and looks up the
 * corresponding user record by the `privyDid` index.
 *
 * Throws if unauthenticated, if the DID claim is missing, or if
 * no Convex user exists for the given DID.
 */
export async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const privyDid = identity.subject
  if (!privyDid) throw new Error("Missing subject claim in identity")

  const user = await ctx.db
    .query("users")
    .withIndex("by_privyDid", (q) => q.eq("privyDid", privyDid))
    .unique()
  if (!user) throw new Error("User not found")

  return user._id
}
