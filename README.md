# LeoVODS

Fan-made Kick toolkit inspired by kickbot.com — **all features work locally**.

- ⬇ VOD downloader (160p → 1080p60 MP4 + MP3, trim by time, m3u8 extract)
- 📺 Channel explorer (profile, live badge, recent VODs)
- 🔴 Live checker, 🎬 clip downloader
- 🎙 TTS studio (browser voices), 🤖 command builder, 🔔 alert + chat widget previews

## Run it

```powershell
cd leovods
npm install
npm start
```

Open http://localhost:3001 — landing page.
Toolkit: http://localhost:3001/app
YouTube MP3/MP4: http://localhost:3001/yt
Health: http://localhost:3001/api/health

Engine: Kick public API (`/api/v1/video/{uuid}`, `/api/v2/channels/{slug}`) first,
watch-page data second (covers Kick's newer "WebVideo" VODs that the old API
and yt-dlp don't know about), direct HLS playlists third, bundled
`bin/yt-dlp.exe` as fallback.
Only public VODs/clips work (private, sub-only, deleted = error, same as KickBot).

## Supported link forms

Both work (the server canonicalizes them automatically):

- `https://kick.com/<channel>/videos/<uuid>`
- `https://kick.com/video/<uuid>` (channel looked up via Kick API)

## API

- `GET /api/vod-info?url=` — title, thumbnail, duration, formats
- `GET /api/stream-url?url=&quality=` — direct m3u8(s)
- `GET /api/download?url=&quality=best|1080p60…&format=mp4|mp3&start=&end=` — file download
- `GET /api/channel?slug=` — profile + live + VODs
- `GET /api/clip-info?url=` — clip metadata

## If a VOD fails with 404

Kick returns 404 when a VOD is deleted, expired (Kick keeps VODs a limited
time), sub-only, or the link/uuid is wrong. To rule out a bad link, open the
**Channel Explorer** tab, search the channel, and download the VOD from the
Recent VODs list. If it 404s there too, Kick no longer serves it publicly.
"# leovods" 
