# Simulcast — E2E manual test

## Prerequisites
- RealtimeKit webhook registered for `meeting.ended` + `livestreaming.statusUpdate`
- YouTube account connected via `/dashboard/settings/stream`
- X (Twitter) connected via manual RTMP paste on `/dashboard/settings/stream`
- `CLOUDFLARE_STREAM_API_TOKEN` set in Convex dashboard

## Happy paths
### YouTube only
(same as v2 checklist)

### X only
1. Go live with X toggle ON, YouTube OFF.
2. Confirm `streamBroadcasts` row has platform=x, status=live, rtkRecordingId set, cloudflareLiveOutputUid set.
3. Confirm stream appears on X Media Studio → Live Producer.
4. End stream; confirm Live Output deleted, recording stopped, broadcast ended.

### YouTube + X simultaneously
1. Go live with both toggles ON.
2. Confirm two streamBroadcasts rows (platform=youtube, platform=x), both status=live, same rtkRecordingId, different cloudflareLiveOutputUids.
3. Confirm one Cloudflare Stream Live Input exists for the creator (in Cloudflare dashboard → Stream → Live Inputs).
4. Confirm both YouTube and X show the live stream.
5. End stream; confirm both Live Outputs deleted, the ONE recording stopped, both broadcasts ended.

## Graceful degrade paths
- YouTube fails, X succeeds → stream live with X, YouTube broadcast status=failed.
- X fails (invalid stream key), YouTube succeeds → symmetrical.
- Both fail → stream still live on Switched; two failed streamBroadcasts rows.

## Unexpected end
Same as v2: kill browser → webhook fires → all Live Outputs deleted, recording stopped, all broadcasts ended.
