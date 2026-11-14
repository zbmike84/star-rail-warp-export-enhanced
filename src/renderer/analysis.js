// Everything the analysis UI needs, derived from one account's records.
import { buildCollection } from './luck.js'
import { judge, winRate, POOL_KIND } from './judge.js'

// Community models of the official rates: flat base rate, then +step per pull from `soft`,
// hard pity at `cap`. Light cone soft pity is less well established (sources say 65-70).
const MODELS = {
  character: { base: 0.006, soft: 74, step: 0.06, cap: 90 },
  lightcone: { base: 0.008, soft: 66, step: 0.07, cap: 80 },
}
MODELS.standard = MODELS.character

export function pityModel(kind) {
  const m = MODELS[kind] || MODELS.character
  const pmf = []
  let survive = 1
  for (let n = 1; n <= m.cap; n++) {
    const p = n === m.cap ? 1 : n < m.soft ? m.base : Math.min(1, m.base + m.step * (n - m.soft + 1))
    pmf.push(survive * p)
    survive *= 1 - p
  }
  const mean = pmf.reduce((s, p, i) => s + (i + 1) * p, 0)
  const pastSoft = pmf.slice(m.soft - 1).reduce((a, b) => a + b, 0)
  return { ...m, pmf, mean, pastSoft }
}

// Star Rail has no Capturing Radiance; kept for the shared components
export const RADIANCE_SINCE = '9999'

const verKey = v => v.split('.').map(Number)
const verCmp = (a, b) => { const x = verKey(a), y = verKey(b); return x[0] - y[0] || (x[1] || 0) - (y[1] || 0) }

// idJson: src/idJson.json (passed in, so this module also runs under Node for tests)
export function analyse(account, bannerData, { extras = {}, idJson = {} } = {}) {
  const { pools, issues } = judge(account.result, bannerData)

  // version of a record: its banner's version, else (standard warp) by date
  const byGid = new Map()
  for (const b of bannerData.banners) for (const g of b.gachaIds) byGid.set(String(g), b)
  const starts = new Map()
  for (const b of bannerData.banners) {
    if (!b.version || !b.start) continue
    const s = b.start.slice(0, 19).replace('T', ' ')
    if (!starts.has(b.version) || s < starts.get(b.version)) starts.set(b.version, s)
  }
  const byDate = [...starts].sort((a, b) => verCmp(a[0], b[0]))
  const versionOf = r => {
    const b = byGid.get(String(r.gacha_id))
    if (b?.version) return b.version
    let v = null
    for (const [ver, s] of byDate) { if (s <= r.time) v = ver; else break }
    return v
  }

  const perVersion = new Map()
  const entries = account.result instanceof Map ? [...account.result] : account.result
  const recVersion = new Map()
  for (const [key, recs] of entries) {
    if (!POOL_KIND[key]) continue
    for (const r of recs) {
      const v = versionOf(r)
      if (!v) continue
      recVersion.set(r.id, v)
      if (!perVersion.has(v)) perVersion.set(v, { version: v, total: 0, pools: {}, fives: [] })
      const e = perVersion.get(v)
      e.total++
      e.pools[key] = (e.pools[key] || 0) + 1
    }
  }
  for (const [key, p] of Object.entries(pools)) {
    if (key === '2') continue
    for (const f of p.fives) perVersion.get(recVersion.get(f.id))?.fives.push(f)
  }

  const character = pools['11']
  const rate = character ? winRate(character.fives) : null
  const versions = [...perVersion.values()].sort((a, b) => verCmp(a.version, b.version))
  for (const v of versions) v.fives.sort((a, b) => (a.time < b.time ? -1 : 1))
  const limited = new Set(bannerData.banners.filter(b => b.kind === 'character').flatMap(b => b.up5))
  // every 5★ / S-rank character, in the account's language, for adding copies obtained outside the gacha
  const names = idJson[account.lang] || idJson['en-us'] || {}
  const characters = Object.entries(names).filter(([id, v]) => id.length === 4 && !id.startsWith('8') && String(v.rank_type) === '5')
    .map(([id, v]) => ({ id, name: v.name }))
  const nameOf = id => characters.find(c => c.id === id)?.name
  const collection = buildCollection(pools, f => limited.has(f.itemId), extras, nameOf)
  return { pools, issues, rate, radiance: null, versions, collection, characters }
}
