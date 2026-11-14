// Star Rail banner data (which items were rate-up on which gacha_id).
//
// Source: PolyxiaBannerData (github.com/sirarikako/PolyxiaBannerData). It has no licence
// yet, so it is downloaded at runtime and cached in userData instead of being shipped in
// this repository. Built-in overrides fill gaps (new banners not catalogued yet).
const { ipcMain } = require('electron')
const fetch = require('electron-fetch').default
const path = require('path')
const fs = require('fs-extra')
const { userDataPath } = require('./utils')
const overrides = require('../data/banner-overrides.json')

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/sirarikako/PolyxiaBannerData@main/public/v1/starrail.json',
  'https://raw.githubusercontent.com/sirarikako/PolyxiaBannerData/main/public/v1/starrail.json',
]
const cacheFile = path.join(userDataPath, 'banners-starrail.json')
const MAX_AGE = 12 * 3600e3

const KIND = {
  character_event: 'character', light_cone_event: 'lightcone',
  collab_character: 'character', collab_light_cone: 'lightcone',
  standard: 'standard', beginner: 'standard',
}

// PolyxiaBannerData schema v1 -> flat banners keyed by gacha_id
function normalize(raw) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.banners)) throw new Error('unexpected banner data format')
  const out = []
  for (const b of raw.banners) {
    if (!b.gachaIds?.length) continue
    out.push({
      gachaIds: b.gachaIds.map(String),
      gachaType: String(b.gachaTypes?.raw?.[0] ?? ''),
      kind: KIND[b.poolType] || 'standard',
      version: b.gameVersion || null,
      phase: b.phase ?? null,
      name: b.names?.['zh-CN'] || '',
      start: b.regions?.[0]?.startAt || null,
      end: b.regions?.[0]?.endAt || null,
      up5: (b.featured?.fiveStar || []).map(x => x.itemId && String(x.itemId)).filter(Boolean),
      up4: (b.featured?.fourStar || []).map(x => x.itemId && String(x.itemId)).filter(Boolean),
      names: Object.fromEntries([...(b.featured?.fiveStar || []), ...(b.featured?.fourStar || [])]
        .filter(x => x.itemId).map(x => [String(x.itemId), x.names?.['zh-CN'] || ''])),
    })
  }
  const known = new Set(out.flatMap(b => b.gachaIds))
  for (const o of overrides.banners) {
    if (o.gachaIds.some(id => known.has(id))) continue
    out.push({ ...o, kind: KIND[o.kind] || o.kind, names: o.names || {} })
  }
  return { generatedAt: raw.generatedAt || null, banners: out }
}

async function download() {
  let lastError
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { timeout: 20000 })
      if (!res.ok) { lastError = new Error(`${res.status} ${url}`); continue }
      const raw = await res.json()
      normalize(raw)   // validate before caching
      return raw
    } catch (e) { lastError = e }
  }
  throw lastError
}

async function getBanners(force = false) {
  let cached = null
  try { cached = await fs.readJSON(cacheFile) } catch (e) { /* no cache yet */ }
  const fresh = cached && Date.now() - cached.fetchedAt < MAX_AGE
  if (!fresh || force) {
    try {
      const raw = await download()
      cached = { fetchedAt: Date.now(), raw }
      await fs.outputJSON(cacheFile, cached)
    } catch (e) {
      if (!cached) return { ok: false, error: String(e.message || e) }
      return { ok: true, stale: true, error: String(e.message || e), fetchedAt: cached.fetchedAt, ...normalize(cached.raw) }
    }
  }
  return { ok: true, stale: false, fetchedAt: cached.fetchedAt, ...normalize(cached.raw) }
}

ipcMain.handle('GET_BANNERS', (event, force) => getBanners(!!force))

module.exports = { normalize }
