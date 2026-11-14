<template>
  <section v-if="rows.length" class="panel">
    <h2>{{ text.fortune.title }}</h2>
    <p class="sub">{{ text.fortune.hint }}</p>
    <div class="rows">
      <div v-for="r of rows" :key="r.key" class="r">
        <span class="label">{{ r.label }}</span>
        <span class="tier"><i :style="{ background: TIER_COLORS[r.tier] }"></i>{{ text.tier[r.tier] }}</span>
        <span class="pct">{{ topText(r.top, text) }}</span>
        <span class="scale" role="img" :aria-label="topText(r.top, text)">
          <span class="band" v-for="[key] of BANDS" :key="key" :style="{ background: TIER_COLORS[key] }"></span>
          <b :style="{ left: `${(1 - r.top) * 100}%` }"></b>
        </span>
        <span class="detail">{{ r.detail }}</span>
      </div>
    </div>
    <p class="note">{{ text.fortune.note }}</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { fmt, topText, TIER_COLORS } from '../analysisUi'
import { speedLuck, fiftyLuck, tierOf } from '../luck.js'

const props = defineProps({ analysis: Object, typeMap: Map, text: Object })
// bar reads unlucky (left) -> lucky (right); the marker sits at 1 - top. Widths in %.
const BANDS = [['cursed', 5], ['unlucky', 20], ['average', 50], ['lucky', 20], ['blessed', 5]]

const rows = computed(() => {
  const t = props.text.fortune, out = []
  for (const k of ['11', '12']) {
    const p = props.analysis.pools[k]
    if (!p?.fives.length) continue
    const T = p.fives.reduce((s, f) => s + f.pity, 0) + p.pity
    const r = speedLuck(p.kind, p.fives.length, T)
    out.push({
      key: `speed-${k}`, label: fmt(t.speed, { pool: props.typeMap.get(k) || k }), top: r.top, tier: tierOf(r.top),
      detail: fmt(t.speedDetail, { n: p.fives.length, t: T.toLocaleString(), c: p.pity }),
    })
  }
  for (const [k, label, detail] of [['11', t.fifty, t.fiftyDetail], ['12', t.fiftyLc, t.fiftyLcDetail]]) {
    const p = props.analysis.pools[k]
    if (!p) continue
    const f = fiftyLuck(p.fives, p.kind)
    if (f.n) out.push({
      key: `fifty-${k}`, label, top: f.top, tier: tierOf(f.top),
      detail: fmt(detail, { n: f.n, w: f.w, e: f.expected.toFixed(1) }),
    })
  }
  return out
})
</script>

<style scoped>
.panel { padding: 16px 18px; border: 1px solid #e4e7ed; border-radius: 8px; background: #fff }
h2 { margin: 0; font-size: 16px; font-weight: 600; color: #303133 }
.sub { margin: 2px 0 0; font-size: 12px; color: #909399 }
.rows { display: flex; flex-direction: column; gap: 10px; margin-top: 12px }
.r { display: grid; grid-template-columns: 150px 84px 76px minmax(120px, 220px) minmax(0, 1fr); gap: 12px; align-items: center; font-size: 13px; color: #606266 }
@media (max-width: 860px) {
  .r { grid-template-columns: 130px 80px 70px minmax(0, 1fr) }
  .detail { grid-column: 1 / -1; margin-top: -6px }
}
.label { color: #303133 }
.tier { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #303133; white-space: nowrap }
.tier i { width: 10px; height: 10px; border-radius: 50%; flex: none }
.pct { font-variant-numeric: tabular-nums; white-space: nowrap }
.scale { position: relative; display: grid; grid-template-columns: 5fr 20fr 50fr 20fr 5fr; gap: 2px; height: 8px }
.scale .band { border-radius: 2px; opacity: 0.55 }
.scale b { position: absolute; top: -4px; width: 4px; height: 16px; margin-left: -2px; border-radius: 2px; background: #303133; box-shadow: 0 0 0 2px #fff }
.detail { font-size: 12px; color: #909399 }
.note { margin: 12px 0 0; font-size: 12px; line-height: 1.6; color: #909399 }
</style>
