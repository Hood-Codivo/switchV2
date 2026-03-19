// Derives a Cloudflare Stream thumbnail URL from a live HLS playback URL.
// Expected input format:
//   https://customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8
// Output:
//   https://customer-<code>.cloudflarestream.com/<uid>/thumbnails/thumbnail.jpg
export function getThumbnailUrl(playbackUrl: string): string {
  return playbackUrl.replace("/manifest/video.m3u8", "/thumbnails/thumbnail.jpg")
}
