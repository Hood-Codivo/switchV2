# YouTube Simulcast — E2E manual test

## Prerequisites
- RealtimeKit webhook subscribed to `meeting.ended` and `livestreaming.statusUpdate`, pointing at `https://<deployment>.convex.site/webhooks/rtk`
- No shared secret required — RealtimeKit uses RSA public-key verification (public key fetched automatically from `https://api.realtime.cloudflare.com/.well-known/webhooks.json`)
- YouTube account connected via `/dashboard/settings/stream`

## Happy path
1. Open studio as creator, start meeting
2. Click "Go Live"
3. Toggle YouTube ON
4. Fill YouTube title "Simulcast smoke test"; Privacy: unlisted
5. Click Go Live
6. Within 30s: Switched shows LIVE, SimulcastStatus shows "LIVE on YouTube"
7. Open YouTube Studio → confirm broadcast is live
8. Click End Stream
9. SimulcastStatus clears; YouTube broadcast transitions to ended

## Graceful degrade — YouTube auth expired
1. Convex dashboard: patch YouTube connection `status="expired"`
2. Studio → toggle YouTube → Go Live
3. Confirm dialog appears; click OK
4. Switched goes live; `streamBroadcasts.status="failed"`

## Unexpected end — browser crash
1. Start simulcast as in Happy Path
2. Force-close the tab
3. Within ~2 min webhook fires cleanup (or 5 min cron as backup)
4. Convex: `stream.status=ended`, `streamBroadcasts.status=ended`
5. YouTube Studio: broadcast no longer live
