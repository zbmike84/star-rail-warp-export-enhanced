// Classify every 5★ against the banner it was pulled on.
//
// Star Rail records carry gacha_id (the exact banner) and item_id, so no time matching or
// name lookup is needed. A 5★ is a "win" when its item_id is one of that banner's rate-up
// 5★, otherwise a "lose". No list of standard characters is consulted, so retired limited
// characters in the lose pool and standard characters on rate-up are handled as they come.
//
// judge(result, bannerData) -> { pools, issues }
//   result: Map or [[gachaType, records]] as stored by getData.js; a record is
//           { id, item_id, item_type, name, rank_type, time, gacha_id, gacha_type }
//   bannerData: { banners: [{ gachaIds, kind, version, phase, name, up5, up4, names }] }

// pity is tracked per gacha_type; collab warps (21/22) have their own counters
export const POOL_KIND = { '11': 'character', '21': 'character', '12': 'lightcone', '22': 'lightcone', '1': 'standard', '2': 'standard' }

const byId = (a, b) => {
  if (a.id && b.id) return BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0
  return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
}

// A loss and the guaranteed 5★ it paid for point at each other (they may sit on different banners)
const ref = f => ({ id: f.id, name: f.name, time: f.time, key: f.bannerKey, up: f.up })
function link(loss, guaranteed) {
  if (!loss || !guaranteed) return
  loss.guaranteeTo = ref(guaranteed)
  guaranteed.guaranteeFrom = ref(loss)
}

export function judge(result, bannerData) {
  const banners = new Map()
  for (const b of bannerData?.banners || []) for (const g of b.gachaIds) banners.set(String(g), b)
  const entries = result instanceof Map ? [...result] : result

  // localized names from the records themselves, so UP names follow the game language
  const nameOf = new Map()
  for (const [, recs] of entries) for (const r of recs) nameOf.set(String(r.item_id), r.name)
  const upName = (b, id) => nameOf.get(id) || b.names?.[id] || id

  const pools = {}
  const issues = []
  for (const [key, records] of entries) {
    const kind = POOL_KIND[key]
    if (!kind) continue
    const recs = [...records].sort(byId)
    const fives = []
    let pity = 0, guaranteed = false, streak = 0
    let pendingLoss = null   // the lost 5★ whose guarantee hasn't been used yet
    for (const r of recs) {
      pity++
      if (String(r.rank_type) !== '5') continue
      const f = {
        id: r.id, time: r.time, name: r.name, itemId: String(r.item_id), pity,
        gachaType: String(r.gacha_type), gachaId: String(r.gacha_id), result: 'unknown',
      }
      pity = 0
      fives.push(f)
      if (kind === 'standard') { f.result = 'standard'; continue }
      const b = banners.get(f.gachaId)
      if (!b || !b.up5.length) {
        f.note = b ? 'banner has no rate-up 5★ listed' : `unknown gacha_id ${f.gachaId}`
        issues.push({ pool: key, ...f })
        continue
      }
      f.banner = { gachaId: f.gachaId, version: b.version, phase: b.phase, name: b.name }
      f.bannerKey = f.gachaId   // the 5★ history groups by this
      f.up = b.up5.map(id => upName(b, id))
      const inUp = b.up5.includes(f.itemId)
      if (kind === 'character') {
        if (guaranteed) {
          f.result = 'guaranteed'
          if (!inUp) { f.note = 'lost a guaranteed pull'; issues.push({ pool: key, ...f }) }
          guaranteed = false
          link(pendingLoss, f); pendingLoss = null
        } else {
          f.streakBefore = streak
          if (inUp) { f.result = 'win'; streak = 0 } else { f.result = 'lose'; guaranteed = true; streak++; pendingLoss = f }
        }
      } else {
        // light cones: 75% rate-up, then guaranteed
        f.result = inUp ? (guaranteed ? 'up_guaranteed' : 'up') : 'off'
        if (guaranteed && !inUp) { f.note = 'off-banner right after off-banner'; issues.push({ pool: key, ...f }) }
        if (guaranteed) { link(pendingLoss, f); pendingLoss = null }
        if (!inUp) pendingLoss = f
        guaranteed = !inUp
      }
    }
    pools[key] = { kind, total: recs.length, pity, guaranteed: kind === 'standard' ? false : guaranteed, streak, fives }
  }
  return { pools, issues }
}

// Win rate over 50/50s only, with a 95% Wilson interval
export function winRate(fives) {
  const w = fives.filter(f => f.result === 'win').length
  const n = w + fives.filter(f => f.result === 'lose').length
  if (!n) return { w, n, rate: null, lo: null, hi: null }
  const z = 1.96, p = w / n, den = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
  return { w, n, rate: p, lo: c - h, hi: c + h }
}
