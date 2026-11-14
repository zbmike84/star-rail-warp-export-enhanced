// "How lucky am I", as a percentile among players pulling under the same rules.
// top = share of players who did better than you (ties count half), so
//   top 0.05 -> luckier than 95% of players.
// Purely for fun: it leans on community models of the rates.
import { pityModel } from './analysis.js'

// chance that a non-guaranteed 5★ is the rate-up one
export const UP_CHANCE = { character: 0.5, lightcone: 0.75 }

export const TIERS = [
  { key: 'blessed', max: 0.05 },
  { key: 'lucky', max: 0.25 },
  { key: 'average', max: 0.75 },
  { key: 'unlucky', max: 0.95 },
  { key: 'cursed', max: 1 },
]
export const tierOf = top => TIERS.find(t => top <= t.max)?.key ?? 'cursed'

function erf(x) {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2))

const momentsCache = new WeakMap()
function moments(pmf) {
  if (!momentsCache.has(pmf)) {
    const mean = pmf.reduce((s, p, i) => s + (i + 1) * p, 0)
    const varr = pmf.reduce((s, p, i) => s + (i + 1 - mean) ** 2 * p, 0)
    momentsCache.set(pmf, { mean, sd: Math.sqrt(varr) })
  }
  return momentsCache.get(pmf)
}

// P(the k-th 5★ arrives within T pulls) = P(S_k <= T), S_k = sum of k pity counts.
// Exact convolution for small k, normal approximation (with continuity correction) above.
export function sumCdf(pmf, k, T) {
  if (k <= 0) return 1
  if (T < k) return 0
  if (k <= 40) {
    let d = new Float64Array(T + 1); d[0] = 1
    for (let i = 0; i < k; i++) {
      const nd = new Float64Array(T + 1)
      for (let s = 0; s <= T; s++) {
        if (!d[s]) continue
        for (let j = 0; j < pmf.length && s + j + 1 <= T; j++) nd[s + j + 1] += d[s] * pmf[j]
      }
      d = nd
    }
    return Math.min(1, d.reduce((a, b) => a + b, 0))
  }
  const { mean, sd } = moments(pmf)
  return normCdf((T + 0.5 - k * mean) / (sd * Math.sqrt(k)))
}

// You got N 5★ in T pulls (T may include pulls since your last 5★).
// X = 5★ a random player gets in T pulls; top = P(X > N) + P(X = N) / 2.
export function speedLuck(kind, N, T) {
  const { pmf } = pityModel(kind)
  const geN = sumCdf(pmf, N, T), gtN = sumCdf(pmf, N + 1, T)
  return { N, T, top: gtN + (geN - gtN) / 2 }
}

// Non-guaranteed 5★ as a binomial: wins = rate-up ones. Character: 50%, light cone: 75%.
export function fiftyLuck(fives, kind = 'character') {
  const p = UP_CHANCE[kind] ?? 0.5
  const won = kind === 'character' ? ['win'] : ['up']
  const lost = kind === 'character' ? ['lose'] : ['off']
  const ps = []
  let w = 0
  for (const f of fives) {
    if (won.includes(f.result)) w++
    else if (!lost.includes(f.result)) continue
    ps.push(p)
  }
  let d = [1]
  for (const q of ps) {
    const nd = new Array(d.length + 1).fill(0)
    d.forEach((v, i) => { nd[i] += v * (1 - q); nd[i + 1] += v * q })
    d = nd
  }
  const gt = d.slice(w + 1).reduce((a, b) => a + b, 0)
  return { w, n: ps.length, expected: ps.length * p, top: ps.length ? gt + d[w] / 2 : 0.5 }
}

// Pulls per rate-up 5★: all pulls that produced a 5★, divided by the rate-up ones.
export function upAverage(pool) {
  const fives = pool?.fives || []
  const isUp = f => ['win', 'guaranteed', 'up', 'up_guaranteed'].includes(f.result)
  const ups = fives.filter(isUp).length
  const pulls = fives.reduce((s, f) => s + f.pity, 0)
  return { ups, pulls, avg: ups ? pulls / ups : null }
}

// Expected pulls per rate-up 5★ under the models (a loss costs one extra 5★)
export function expectedUpAverage(kind) {
  if (!(kind in UP_CHANCE)) return null
  const v = pityModel(kind).mean * (2 - UP_CHANCE[kind])
  return { pre: v, post: v }
}
