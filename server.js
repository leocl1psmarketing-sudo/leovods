/**
 * LeoVODS — backend
 * Fully functioning Kick VOD / Clip / Live toolkit.
 * - Kick public API (kick.com/api/v1/video, /api/v2/channels) for fast metadata
 * - Bundled yt-dlp for formats + real MP4/MP3 downloads (HLS -> mp4)
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- yt-dlp binary ----------
const WIN_BIN = path.join(__dirname, 'bin', 'yt-dlp.exe');
const YTDLP = fs.existsSync(WIN_BIN) ? WIN_BIN : 'yt-dlp';

// ---------- helpers ----------
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KICK_RE = /^(https?:\/\/)?(www\.)?kick\.com\//i;

function extractUuid(url) {
  const m = String(url || '').match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}
function extractSlug(url) {
  // https://kick.com/<slug>/videos/<uuid>  or https://kick.com/<slug>
  const m = String(url || '').match(/kick\.com\/([A-Za-z0-9_][A-Za-z0-9_\-]*)/i);
  if (!m) return null;
  const s = m[1].toLowerCase();
  if (['video', 'videos', 'categories', 'search', 'auth', 'login'].includes(s)) return null;
  return m[1];
}
function sanitizeFilename(name) {
  return (String(name || 'kick-vod').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)) || 'kick-vod';
}
function contentDisposition(filename, ext) {
  const base = sanitizeFilename(filename);
  const ascii = base.replace(/[^\x20-\x7E]/g, '_') || 'kick-vod';
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(base)}.${ext}`;
}
function formatDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function parseTimeToSec(v) {
  if (v === undefined || v === null || v === '') return null;
  if (/^\d+$/.test(String(v).trim())) return Math.max(0, parseInt(String(v).trim(), 10));
  const m = String(v).trim().match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/);
  if (m) return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
  return null;
}

function runYtDlp(args, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('Timed out. Kick is slow right now — try again.')); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Converter engine missing (${YTDLP}): ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const lines = stderr.trim().split('\n').slice(-4).join(' ').slice(0, 600);
        reject(new Error(lines || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

// ---------- Premiere-safe MP4 pipeline ----------
// Merging to stdout produces MPEG-TS (mislabeled .mp4) which editors reject,
// and YouTube sources are often AV1/VP9 + Opus which Premiere can't handle.
// So: download+merge to a temp file, then normalize to H.264 + AAC faststart
// MP4 (stream-copy when already compatible), and serve the real file.
const TMPDIR = path.join(os.tmpdir(), 'leovods-tmp');
try { fs.mkdirSync(TMPDIR, { recursive: true }); } catch {}
// Sweep stale temp files from crashed runs on startup.
fs.readdir(TMPDIR, (err, files) => {
  if (!err && files) for (const f of files) fs.unlink(path.join(TMPDIR, f), () => {});
});
function tmpPath(ext) {
  return path.join(TMPDIR, `dl-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`);
}
function rmQuiet(p) { if (p) fs.unlink(p, () => {}); }
function runCmd(cmd, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '', stderr = '';
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error(`${cmd} timed out.`)); }, timeoutMs);
    }
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().split('\n').slice(-4).join(' ').slice(0, 500) || `${cmd} exited with code ${code}`));
    });
  });
}
async function probeStreams(file) {
  const { stdout } = await runCmd('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'csv=p=0', file], { timeoutMs: 60000 });
  const v = [], a = [];
  for (const line of stdout.trim().split('\n')) {
    const [name, type] = line.trim().split(',');
    (type === 'video' ? v : a).push(name);
  }
  return { v: v[0] || '', a: a[0] || '' };
}
async function probeDuration(file) {
  try {
    const { stdout } = await runCmd('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeoutMs: 60000 });
    return Number(stdout.trim()) || 0;
  } catch { return 0; }
}
// Guards against silently serving truncated/corrupt files (the classic
// "plays in VLC, Premiere rejects it" case): the file must probe cleanly,
// and when we know the expected length it must match within tolerance.
async function verifyMediaFile(file, { expectedSec = 0, needVideo = false } = {}) {
  const { v, a } = await probeStreams(file);
  if (needVideo && !v) throw new Error('No video stream in output.');
  if (!v && !a) throw new Error('No playable streams in output.');
  const got = await probeDuration(file);
  if (!(got > 0)) throw new Error('Could not read media duration — output is corrupt.');
  if (expectedSec > 0 && Math.abs(got - expectedSec) > Math.max(8, expectedSec * 0.03)) {
    throw new Error(`Output looks truncated (${Math.round(got)}s vs expected ~${Math.round(expectedSec)}s). Please retry the download.`);
  }
  return { v, a, duration: got };
}
// Normalizes any downloaded media file to H.264 + AAC faststart MP4.
// Stream-copies when already compatible (fast), re-encodes otherwise.
async function toPremiereMp4(inFile, outFile) {
  let v = '', a = '';
  try { ({ v, a } = await probeStreams(inFile)); } catch {}
  const copyOk = /^(h264|avc)/i.test(v) && /^(aac|mp4a)/i.test(a);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile];
  if (copyOk) args.push('-c', 'copy');
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', '-f', 'mp4', outFile);
  await runCmd('ffmpeg', args, { timeoutMs: 3600000 });
  return { copyOk, v, a };
}

async function kickJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Kick API ${r.status}: ${t.slice(0, 160)}`);
  }
  return r.json();
}

function normalizeFormats(ytdlpFormats) {
  // Kick gives 160p/360p/480p/720p60/1080p60 (+sometimes source). Keep readable order.
  const order = { '160p': 0, '360p': 1, '480p': 2, '720p': 3, '720p60': 4, '1080p': 5, '1080p60': 6, 'source': 7 };
  return (ytdlpFormats || [])
    .filter((f) => f && f.url && /m3u8|mp4/i.test(`${f.ext} ${f.protocol} ${f.url}`))
    .map((f) => ({
      id: f.format_id,
      label: f.format_id,
      width: f.width || null,
      height: f.height || null,
      fps: f.fps || null,
      tbr: f.tbr || null,
      url: f.url
    }))
    .sort((a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9));
}

// ---------- Kick HLS direct support (no yt-dlp needed) ----------
// Kick's API returns a master.m3u8 (`source`). Variant playlists live next to
// it as <folder>/playlist.m3u8, e.g. 1080p60/playlist.m3u8. Fetching + parsing
// the master gives us real qualities and direct URLs even when yt-dlp's Kick
// extractor is broken or the pasted URL form isn't one yt-dlp understands.
async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parseMasterM3U8(text, masterUrl) {
  const base = masterUrl.slice(0, masterUrl.lastIndexOf('/') + 1);
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#EXT-X-STREAM-INF:(.+)$/);
    if (!m) continue;
    const attrs = m[1];
    const uri = (lines[i + 1] && !lines[i + 1].startsWith('#')) ? lines[i + 1] : null;
    if (!uri) continue;
    const res = (attrs.match(/RESOLUTION=(\d+)x(\d+)/) || []);
    const bw = Number((attrs.match(/BANDWIDTH=(\d+)/) || [])[1]) || null;
    const fr = Number((attrs.match(/FRAME-RATE=([\d.]+)/) || [])[1]) || null;
    const folder = uri.split('/')[0]; // e.g. "1080p60"
    // Display id matches yt-dlp convention: 480p30 -> 480p, keep 720p60/1080p60
    const id = /p30$/.test(folder) ? folder.replace(/p30$/, 'p') : folder;
    out.push({
      id, folder,
      label: id,
      width: Number(res[1]) || null,
      height: Number(res[2]) || null,
      fps: fr ? Math.round(fr) : (/60$/.test(folder) ? 60 : 30),
      tbr: bw ? Math.round(bw / 1000) : null,
      url: /^https?:\/\//.test(uri) ? uri : (base + uri)
    });
  }
  const order = { '160p': 0, '360p': 1, '480p': 2, '720p': 3, '720p60': 4, '1080p': 5, '1080p60': 6 };
  return out.sort((a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9));
}

// Map user-facing quality names to variant folders. Accepts yt-dlp ids,
// master folder names, and plain heights.
function variantForQuality(formats, quality) {
  if (!formats || !formats.length) return null;
  const q = String(quality || 'best').toLowerCase();
  if (q === 'best' || q === 'source' || q === 'highest' || q === 'max') return formats[formats.length - 1];
  const norm = (s) => String(s).toLowerCase();
  let f = formats.find((x) => norm(x.id) === q || norm(x.folder) === q);
  if (f) return f;
  const h = (q.match(/(\d{3,4})/) || [])[1];
  if (h) {
    const byHeight = formats.filter((x) => x.height === Number(h));
    if (byHeight.length) return byHeight[byHeight.length - 1]; // highest fps at that height
  }
  return null;
}

function variantPlaylistUrl(masterUrl, folder) {
  return masterUrl.slice(0, masterUrl.lastIndexOf('/') + 1) + folder + '/playlist.m3u8';
}

// ---------- Watch-page scrape fallback ----------
// Kick's new video system ("WebVideo") doesn't answer the old
// /api/v1/video/{uuid} endpoint, and this yt-dlp build's kick:vod extractor
// 404s on those VODs too — yet the watch page plays fine anonymously with
// the stream data server-rendered into the HTML (recording_url = master
// m3u8, title, duration, views...). So scrape it straight out of the page.
function cleanScraped(s) {
  if (s == null) return s;
  return String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function sliceVideoObject(flat, uuid) {
  const anchor = flat.indexOf(`"id":"${uuid}"`);
  if (anchor === -1) return null;
  return flat.slice(Math.max(0, anchor - 900), anchor + 4500);
}
const grabStr = (src, name) => {
  const m = src.match(new RegExp('"' + name + '":"([^"]*)"'));
  return m ? cleanScraped(m[1]) : null;
};
const grabNum = (src, name) => {
  const m = src.match(new RegExp('"' + name + '":(\\d+(?:\\.\\d+)?)'));
  return m ? Number(m[1]) : null;
};
// Returns null when the page has no playable VOD (deleted/expired/private).
async function scrapeWatchPage(pageUrl, uuid) {
  let html;
  try { html = await fetchText(pageUrl, { timeoutMs: 25000 }); }
  catch { return null; }
  if (!html || !html.includes('recording_url')) return null;
  const flat = html.replace(/\\+"/g, '"');
  const win = sliceVideoObject(flat, uuid);
  if (!win) return null;
  const recordingUrl = grabStr(win, 'recording_url');
  if (!/^https?:\/\/.+m3u8/i.test(recordingUrl || '')) return null;
  const chM = win.match(/"channel":\{"id":\d+,"slug":"([^"]+)","username":"([^"]+)"\}/);
  const thumbM = win.match(/"thumbnail":\{"frame_ms":\d+,"src":"([^"]*)"/);
  // Meta description carries the same title under different escaping — take
  // whichever capture is longer (guards against a truncated match).
  const descM = flat.match(/"name":"description","content":"([^"]*)"/);
  const metaDesc = descM ? cleanScraped(descM[1]) : null;
  const objTitle = grabStr(win, 'title');
  const title = [objTitle, metaDesc].filter(Boolean).sort((a, b) => b.length - a.length)[0] || null;
  return {
    source: recordingUrl,
    title, durationSec: grabNum(win, 'duration'), views: grabNum(win, 'viewer_count'),
    channelSlug: chM ? chM[1] : null, channelName: chM ? chM[2] : null,
    thumbnail: thumbM ? thumbM[1] : null,
    createdAt: grabStr(win, 'start_time'), expiresAt: grabStr(win, 'original_expires_at'),
    mature: win.includes('"is_mature":true')
  };
}

// In-memory cache for vod-info (Kick API + yt-dlp is a bit slow)
const infoCache = new Map(); // uuid -> { at, data }
const CACHE_TTL = 10 * 60 * 1000;

async function getVodInfo(kickUrl) {
  const uuid = extractUuid(kickUrl);
  if (!uuid) throw new Error('Could not find a VOD id in that URL. Use a link like https://kick.com/<channel>/videos/<uuid>.');
  const cached = infoCache.get(uuid);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  // 1) Kick API (slug-independent, and tells us the channel for canonical URLs)
  let api = null, apiErr = null;
  try { api = await kickJson(`https://kick.com/api/v1/video/${uuid}`); }
  catch (e) { apiErr = e.message; }

  const ls = api?.livestream || null;
  const ch = api?.livestream?.channel || null;
  const apiSlug = (ch?.slug || '').toLowerCase() || null;

  // 2) yt-dlp for canonical metadata. NOTE: this yt-dlp build only matches
  // kick:vod on `kick.com/<channel>/videos/<uuid>` links — `/video/<uuid>`
  // links fall through to the generic extractor and 404. So retry with the
  // canonical channel URL when we know the slug.
  const pastedSlug = extractSlug(kickUrl);
  const candidates = [String(kickUrl)];
  const canon = apiSlug || pastedSlug;
  if (canon) {
    const c = `https://kick.com/${canon}/videos/${uuid}`;
    if (!candidates.includes(c)) candidates.push(c);
  }
  let y = null, yErr = null;
  for (const u of candidates) {
    try {
      const { stdout } = await runYtDlp(['--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', u], { timeoutMs: 45000 });
      y = JSON.parse(stdout);
      yErr = null;
      break;
    } catch (e) { yErr = e.message; }
  }

  // 3) Watch-page scrape: Kick's new video system ("WebVideo") answers
  // neither the old /api/v1/video endpoint nor yt-dlp — but the watch page
  // plays anonymously with stream data server-rendered into the HTML.
  let page = null;
  if (!y) {
    const pageCandidates = [...candidates].reverse();
    for (const u of pageCandidates) {
      page = await scrapeWatchPage(u, uuid);
      if (page) break;
    }
    if (page?.channelSlug && !canon) {
      const c = `https://kick.com/${page.channelSlug}/videos/${uuid}`;
      if (!pageCandidates.includes(c)) {
        page = (await scrapeWatchPage(c, uuid)) || page;
      }
    }
  }

  // 4) If yt-dlp failed everywhere but we have a master playlist (old API or
  // page scrape), parse it directly for real qualities.
  const masterSrc = api?.source || page?.source || null;
  let directFormats = [];
  if (!y && masterSrc) {
    try {
      const masterText = await fetchText(masterSrc);
      directFormats = parseMasterM3U8(masterText, masterSrc);
    } catch (e) { /* keep empty; error below covers it */ }
  }

  if (!y && !api && !page) {
    const notFound = /404|not found/i.test(`${apiErr} ${yErr}`);
    if (notFound) {
      throw new Error(
        `Kick returned 404 for that VOD id — it is not publicly available (deleted, expired, sub-only, or the link is wrong). ` +
        `Tip: open the channel in Channel Explorer below and download it from the Recent VODs list to rule out a bad link. (id: ${uuid})`
      );
    }
    throw new Error(`Could not read that Kick link. (${String(yErr || apiErr).slice(0, 160)})`);
  }
  if (!y && !directFormats.length) {
    throw new Error(
      `Found the VOD on Kick but could not list its stream qualities. It may be sub-only or restricted. ` +
      `Try playing it on kick.com first — if it plays there, try again here. (id: ${uuid})`
    );
  }

  const durationSec = y?.duration || (ls?.duration ? Math.round(ls.duration / 1000) : (page?.durationSec || 0));
  const pageSlug = (page?.channelSlug || '').toLowerCase() || null;
  const data = {
    uuid,
    id: y?.id || uuid,
    title: y?.title || ls?.session_title || page?.title || 'Kick VOD',
    channel: y?.uploader || y?.channel || ch?.slug || page?.channelName || pageSlug || pastedSlug || 'unknown',
    channelSlug: (y?.channel || ch?.slug || pageSlug || pastedSlug || '').toLowerCase(),
    channelAvatar: ch?.user?.profilepic || null,
    thumbnail: y?.thumbnail || ls?.thumbnail || page?.thumbnail || null,
    durationSec,
    duration: y?.duration_string || formatDuration(durationSec),
    views: y?.view_count ?? api?.views ?? ls?.views ?? page?.views ?? 0,
    createdAt: ls?.created_at || page?.createdAt || (y?.timestamp ? new Date(y.timestamp * 1000).toISOString() : null),
    expiresAt: page?.expiresAt || null,
    mature: page?.mature ?? undefined,
    isLive: !!y?.is_live,
    webpageUrl: y?.webpage_url || (canon ? `https://kick.com/${canon}/videos/${uuid}` : kickUrl),
    source: masterSrc,
    formats: y ? normalizeFormats(y?.formats || []) : directFormats,
    extractor: y?.extractor || (api ? 'kick:api-direct' : (page ? 'kick:page' : 'unknown'))
  };
  infoCache.set(uuid, { at: Date.now(), data });
  return data;
}

// Resolve a playable .m3u8 for a quality. Prefers Kick's own master playlist
// (via cached vod-info) so downloads don't depend on yt-dlp at all.
async function resolveM3u8(kickUrl, quality) {
  const info = await getVodInfo(kickUrl);
  const q = String(quality || 'best');
  if (info.source) {
    try {
      const masterText = await fetchText(info.source);
      const variants = parseMasterM3U8(masterText, info.source);
      const v = variantForQuality(variants, q);
      if (v) return { playlist: v.url, info, matched: v.id };
      // master fetch worked but quality unknown -> best variant
      if (variants.length) return { playlist: variants[variants.length - 1].url, info, matched: variants[variants.length - 1].id };
    } catch (e) { /* fall through to yt-dlp */ }
    // master unfetchable right now: derive variant path directly (stable pattern)
    const folders = ['1080p60', '720p60', '480p30', '360p30', '160p30'];
    const alias = { best: '1080p60', source: '1080p60', '1080p': '1080p60', '720p': '720p60', '480p': '480p30', '360p': '360p30', '160p': '160p30' };
    const folder = alias[q.toLowerCase()] || (/p(30|60)$/.test(q) ? q : null) || (folders.includes(q) ? q : '1080p60');
    return { playlist: variantPlaylistUrl(info.source, folder), info, matched: folder };
  }
  // No API source (e.g. clips): yt-dlp resolves it
  const f = (q === 'best' || q === 'source') ? 'best' : q;
  const { stdout } = await runYtDlp(['-g', '-f', f, '--no-playlist', '--skip-download', '--no-warnings', info.webpageUrl || String(kickUrl)], { timeoutMs: 30000 });
  const line = stdout.trim().split('\n').map((x) => x.trim()).find((x) => /^https?:\/\//.test(x));
  if (!line) throw new Error('No stream URL returned.');
  return { playlist: line, info, matched: f };
}

// ---------- API ----------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, engine: fs.existsSync(WIN_BIN) ? 'yt-dlp-bundled' : 'yt-dlp-path', ffmpeg: true, time: new Date().toISOString() });
});

// GET /api/vod-info?url=https://kick.com/x/videos/uuid
app.get('/api/vod-info', async (req, res) => {
  const { url } = req.query;
  if (!url || !KICK_RE.test(String(url))) return res.status(400).json({ error: 'Paste a kick.com VOD or clip link first.' });
  try {
    const data = await getVodInfo(String(url));
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/stream-url?url=...&quality=720p60  -> direct .m3u8 for VLC / ffmpeg / copying
app.get('/api/stream-url', async (req, res) => {
  const { url, quality = 'best' } = req.query;
  if (!url || !KICK_RE.test(String(url))) return res.status(400).json({ error: 'Invalid Kick URL.' });
  try {
    const { playlist, matched } = await resolveM3u8(String(url), String(quality || 'best'));
    res.json({ quality: matched, urls: [playlist] });
  } catch (err) {
    res.status(502).json({ error: `Could not resolve stream URL: ${err.message.slice(0, 220)}` });
  }
});

// GET /api/download?url=...&quality=1080p60&format=mp4|mp3&start=0&end=60
app.get('/api/download', async (req, res) => {
  const { url, quality = 'best', format = 'mp4', start = '', end = '' } = req.query;
  if (!url || !KICK_RE.test(String(url))) return res.status(400).json({ error: 'Invalid Kick URL.' });
  const fmt = String(format).toLowerCase() === 'mp3' ? 'mp3' : 'mp4';
  const q = String(quality || 'best');

  const s = parseTimeToSec(start), e = parseTimeToSec(end);
  if (s !== null && e !== null && e <= s) return res.status(400).json({ error: 'End time must be after start time.' });
  const hasTrim = s !== null || e !== null;

  // Resolve title + playlist first (Kick API source preferred, yt-dlp fallback).
  // This also fixes `/video/<uuid>` links: the resolver retries with the
  // canonical `kick.com/<channel>/videos/<uuid>` form.
  let info, m3u8;
  try {
    ({ playlist: m3u8, info } = await resolveM3u8(String(url), q));
  } catch (er) {
    return res.status(502).json({ error: `Could not resolve stream: ${er.message.slice(0, 200)}` });
  }
  const title = info.title || 'kick-vod';
  const base = sanitizeFilename(`${title}-${q}`);
  res.setHeader('Content-Disposition', contentDisposition(base, fmt));
  res.setHeader('Content-Type', fmt === 'mp3' ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('X-File-Title', encodeURIComponent(String(title).slice(0, 120)));

  // MP3, trims, and anything with a Kick API source go through ffmpeg reading
  // the HLS playlist directly (`ffmpeg -ss -i <m3u8> -t` is exact and fast).
  if (fmt === 'mp3' || hasTrim || info.source) {
    const startSec = s ?? 0;
    const dur = (s !== null && e !== null) ? (e - s) : (s === null && e !== null ? e : null);
    const fArgs = ['-hide_banner', '-loglevel', 'error'];
    if (hasTrim && startSec > 0) fArgs.push('-ss', String(startSec));
    fArgs.push('-i', m3u8);
    if (dur !== null) fArgs.push('-t', String(dur));
    if (fmt === 'mp3') fArgs.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1');
    else fArgs.push('-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', 'pipe:1');
    const ff = spawn('ffmpeg', fArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let fErr = '';
    ff.stderr.on('data', (d) => { fErr += d.toString(); });
    ff.on('error', (er) => {
      if (!res.headersSent) res.status(500).json({ error: `Audio/video converter missing (install ffmpeg): ${er.message}` });
      else try { res.end(); } catch {}
    });
    ff.on('close', (code) => {
      if (code !== 0 && !res.writableEnded) {
        if (!res.headersSent) res.status(500).json({ error: fErr.slice(-400) || `Conversion failed (code ${code}). Try another quality.` });
        else try { res.end(); } catch {}
      }
    });
    ff.stdout.pipe(res);
    req.on('close', () => { try { ff.kill('SIGKILL'); } catch {} });
    return;
  }

  // Full-length MP4 with no API source (e.g. clips): download to temp, then
  // normalize to a real Premiere-safe MP4 file (merging to stdout would
  // produce MPEG-TS mislabeled as .mp4 — editors reject it).
  {
    const f = (q === 'best' || q === 'source') ? 'best' : q;
    const tmpIn = tmpPath('mkv'), tmpOut = tmpPath('mp4');
    try {
      await runYtDlp(['-f', f, '--merge-output-format', 'mkv', '--no-playlist', '--no-warnings',
        '--concurrent-fragments', '4', '-o', tmpIn, info.webpageUrl || String(url)], { timeoutMs: 3600000 });
      await toPremiereMp4(tmpIn, tmpOut);
    } catch (e) {
      rmQuiet(tmpIn); rmQuiet(tmpOut);
      return res.status(500).json({ error: `Download failed: ${String(e.message).slice(0, 220)}` });
    }
    rmQuiet(tmpIn);
    return res.sendFile(tmpOut, () => rmQuiet(tmpOut));
  }
});

// GET /api/channel?slug=xqc  -> profile + live status + recent VODs
app.get('/api/channel', async (req, res) => {
  const slug = String(req.query.slug || '').trim().toLowerCase().replace(/^@/, '');
  if (!slug || !/^[a-z0-9_][a-z0-9_\-]{1,24}$/i.test(slug)) return res.status(400).json({ error: 'Enter a valid Kick channel name (e.g. xqc).' });
  try {
    const [profile, videos] = await Promise.all([
      kickJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`),
      kickJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/videos`).catch(() => [])
    ]);
    const vods = (Array.isArray(videos) ? videos : []).slice(0, 24).map((v) => ({
      livestreamId: v.id,
      uuid: v?.video?.uuid || null,
      title: v.session_title || 'Untitled stream',
      thumbnail: v?.thumbnail?.src || null,
      durationSec: v.duration ? Math.round(v.duration / 1000) : 0,
      duration: formatDuration(v.duration ? v.duration / 1000 : 0),
      views: v.views ?? v?.video?.views ?? 0,
      createdAt: v.created_at || null,
      url: v?.video?.uuid ? `https://kick.com/${slug}/videos/${v.video.uuid}` : null
    }));
    res.json({
      slug: profile.slug,
      name: profile?.user?.username || slug,
      bio: profile?.user?.bio || '',
      avatar: profile?.user?.profile_pic || null,
      banner: profile?.banner_image?.url || null,
      followers: Number(profile.followers_count) || 0,
      verified: !!profile.verified,
      vodEnabled: !!profile.vod_enabled,
      isLive: !!profile.livestream,
      live: profile.livestream ? {
        title: profile.livestream.session_title,
        viewers: profile.livestream.viewer_count,
        startedAt: profile.livestream.start_time,
        thumbnail: profile.livestream?.thumbnail?.src || null,
        url: `https://kick.com/${slug}`
      } : null,
      vods
    });
  } catch (err) {
    res.status(404).json({ error: `Channel "${slug}" not found on Kick. Check the spelling.` });
  }
});

// GET /api/clip-info?url=... (Kick clips use same extractor; yt-dlp handles them)
app.get('/api/clip-info', async (req, res) => {
  const { url } = req.query;
  if (!url || !KICK_RE.test(String(url))) return res.status(400).json({ error: 'Paste a kick.com clip link.' });
  try {
    const { stdout } = await runYtDlp(['--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', String(url)], { timeoutMs: 30000 });
    const j = JSON.parse(stdout);
    res.json({
      id: j.id, title: j.title || 'Kick clip',
      channel: j.uploader || j.channel || '', thumbnail: j.thumbnail || null,
      durationSec: Math.round(j.duration || 0), duration: formatDuration(j.duration || 0),
      views: j.view_count || 0, webpageUrl: j.webpage_url || url,
      formats: normalizeFormats(j.formats || [])
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read that clip. It may be deleted or private. (${err.message.slice(0, 160)})` });
  }
});

// ---------- YouTube to MP3 / MP4 (same yt-dlp engine) ----------
// For content you own or that permits downloading.
const YT_RE = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{6,}/i;

function getYtVideoID(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function ytFriendlyError(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('private')) return 'This video is private.';
  if (m.includes('age')) return 'This video is age-restricted / sign-in required.';
  if (m.includes('region') || m.includes('country') || m.includes('geo')) return 'This video is region-blocked.';
  if (m.includes('sign in') || m.includes('log in') || m.includes('confirm you')) return 'YouTube is asking for sign-in / bot-check on this video — try another one.';
  if (m.includes('unsupported url')) return 'That URL is not supported. Use a youtube.com/watch, youtu.be, or /shorts link.';
  if (m.includes('timed out')) return 'YouTube is slow right now — press Retry.';
  if (m.includes('403') || m.includes('forbidden')) return 'YouTube blocked this stream (403). Press Retry for a fresh link.';
  if (m.includes('404')) return 'Video not found (404). It may have been removed.';
  return null;
}
// Approximate MP4 sizes per quality from yt-dlp filesize hints + audio size.
function ytApproxSizes(formats, durationSec) {
  const dur = Number(durationSec) || 0;
  const out = {};
  for (const h of [360, 720, 1080]) {
    const cands = (formats || []).filter((f) => f && Number(f.height) === h && (f.filesize || f.filesize_approx));
    const prog = cands.find((f) => f.acodec && f.acodec !== 'none' && f.vcodec && f.vcodec !== 'none');
    const pick = prog || cands.sort((a, b) => (b.filesize || b.filesize_approx) - (a.filesize || a.filesize_approx))[0];
    if (pick) out[h + 'p'] = Math.round(pick.filesize || pick.filesize_approx);
    else if (dur) {
      // No hint: rough bitrate-based guess so the UI still shows something.
      const guessKbps = h === 360 ? 800 : h === 720 ? 2500 : 5000;
      out[h + 'p'] = Math.round(guessKbps * 1000 / 8 * dur);
    }
  }
  let audioBytes = 0;
  const audios = (formats || []).filter((f) => f && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && (f.abr || f.tbr));
  if (audios.length && dur) {
    const abr = Math.max(...audios.map((f) => Number(f.abr || f.tbr) || 0));
    if (abr) audioBytes = Math.round(abr * 1000 / 8 * dur * 1.1); // +10% container laissez-marge
  } else if (dur) audioBytes = Math.round(160 * 1000 / 8 * dur);
  return { mp4: out, mp3: audioBytes };
}

// GET /api/yt/info?url=...
app.get('/api/yt/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !YT_RE.test(String(url))) return res.status(400).json({ error: 'Paste a valid YouTube URL (watch / youtu.be / shorts).' });
  try {
    const { stdout } = await runYtDlp([
      '--dump-single-json', '--no-playlist', '--skip-download',
      '--js-runtimes', 'node', '--no-warnings', String(url)
    ], { timeoutMs: 45000 });
    const j = JSON.parse(stdout);
    const thumbs = j.thumbnails || [];
    const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : (j.thumbnail || '');
    res.json({
      id: j.id,
      title: j.title || 'YouTube video',
      author: j.uploader || j.channel || 'Unknown',
      lengthSeconds: Math.round(Number(j.duration) || 0),
      duration: j.duration_string || formatDuration(j.duration),
      thumbnail: thumb,
      views: j.view_count || 0,
      webpageUrl: j.webpage_url || url,
      ...ytApproxSizes(j.formats || [], j.duration)
    });
  } catch (err) {
    res.status(502).json({ error: ytFriendlyError(err.message) || `Could not fetch video info: ${err.message.slice(0, 200)}` });
  }
});

// GET /api/yt/download?url=...&format=mp3|mp4&quality=720p&bitrate=192
app.get('/api/yt/download', async (req, res) => {
  const { url, format = 'mp3', quality = '720p', bitrate = '192' } = req.query;
  if (!url || !YT_RE.test(String(url))) return res.status(400).json({ error: 'Invalid YouTube URL.' });
  const id = getYtVideoID(String(url));
  if (!id) return res.status(400).json({ error: 'Could not parse video ID.' });
  const fmt = String(format).toLowerCase() === 'mp4' ? 'mp4' : 'mp3';

  let title = `youtube-${id}`, expectedSec = 0;
  try {
    const { stdout } = await runYtDlp([
      '--print', '%(title)s', '--print', '%(duration)s',
      '--no-playlist', '--skip-download',
      '--js-runtimes', 'node', '--no-warnings', String(url)
    ], { timeoutMs: 30000 });
    const lines = stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length >= 2 && /^\d+(\.\d+)?$/.test(lines[lines.length - 1])) {
      expectedSec = Number(lines.pop());
      title = lines.join(' ').trim() || title;
    } else if (lines.length) title = lines.join(' ').trim();
  } catch (e) { /* fallback title stands */ }

  if (fmt === 'mp3') {
    // MP3 via temp file + integrity check, so a hiccup mid-transfer can never
    // land as a silently-truncated file (Premiere rejects those).
    const kbps = ['128', '192', '320'].includes(String(bitrate)) ? String(bitrate) : '192';
    const tmpOut = tmpPath('mp3');
    try {
      await runCmd(YTDLP, ['-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3',
        '--audio-quality', `${kbps}K`, '--js-runtimes', 'node',
        '--no-playlist', '--no-warnings', '-o', tmpOut, String(url)], { timeoutMs: 3600000 });
      await verifyMediaFile(tmpOut, { expectedSec });
    } catch (e) {
      rmQuiet(tmpOut);
      return res.status(500).json({ error: ytFriendlyError(e.message) || `Download failed: ${e.message.slice(0, 220)}` });
    }
    res.setHeader('Content-Disposition', contentDisposition(`${title}-${kbps}k`, 'mp3'));
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.sendFile(tmpOut, (err) => {
      rmQuiet(tmpOut);
      if (err && !res.headersSent) res.status(500).json({ error: 'Failed to send file.' });
    });
  }

  {
    // MP4 via temp file -> Premiere-safe H.264 + AAC faststart.
    // (Merging straight to stdout yields MPEG-TS mislabeled as .mp4,
    //  and raw YouTube streams are often AV1/VP9 + Opus — editors reject both.)
    const h = quality === '360p' ? 360 : quality === '1080p' ? 1080 : 720;
    const tmpIn = tmpPath('mkv'), tmpOut = tmpPath('mp4');
    try {
      await runYtDlp([
        '-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`,
        '--merge-output-format', 'mkv', '--js-runtimes', 'node',
        '--no-playlist', '--no-warnings', '-o', tmpIn, String(url)
      ], { timeoutMs: 3600000 });
      await toPremiereMp4(tmpIn, tmpOut);
      await verifyMediaFile(tmpOut, { expectedSec, needVideo: true });
    } catch (e) {
      rmQuiet(tmpIn); rmQuiet(tmpOut);
      return res.status(500).json({ error: ytFriendlyError(e.message) || `Download failed: ${e.message.slice(0, 200)}` });
    }
    rmQuiet(tmpIn);
    res.setHeader('Content-Disposition', contentDisposition(`${title}-${h}p`, 'mp4'));
    res.setHeader('Content-Type', 'video/mp4');
    return res.sendFile(tmpOut, (err) => {
      rmQuiet(tmpOut);
      if (err && !res.headersSent) res.status(500).json({ error: 'Failed to send file.' });
    });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/yt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'yt.html')));
app.get('/messages', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messages.html')));
app.get('/messages', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messages.html')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`LeoVODS running at http://localhost:${PORT}`));
