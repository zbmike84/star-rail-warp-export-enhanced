// node --test test/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { judge, winRate } from '../src/renderer/judge.js'
import { fiftyLuck, speedLuck, expectedUpAverage, upAverage, tierOf } from '../src/renderer/luck.js'
import { pityModel } from '../src/renderer/analysis.js'

const data = {
  banners: [
    // two character banners running at the same time, both gacha_type 11
    { gachaIds: ['2001'], kind: 'character', version: '1.0', phase: 1, name: 'A', up5: ['1205'], up4: [], names: { 1205: '刃' } },
    { gachaIds: ['2002'], kind: 'character', version: '1.0', phase: 1, name: 'B', up5: ['1003'], up4: [], names: {} },   // standard char as UP
    { gachaIds: ['3001'], kind: 'lightcone', version: '1.0', phase: 1, name: 'L', up5: ['23014'], up4: [], names: {} },
    { gachaIds: ['5001'], kind: 'character', version: '3.4', phase: 1, name: 'collab', up5: ['1014'], up4: [], names: {} },
    { gachaIds: ['1001'], kind: 'standard', version: null, phase: null, name: 'std', up5: [], up4: [], names: {} },
  ],
}
let seq = 1000
const rec = (gt, gid, item, name, rank = 5, time = '2024-01-01 00:00:00') =>
  ({ id: String(seq++), item_id: item, item_type: '角色', name, rank_type: String(rank), time, gacha_id: gid, gacha_type: gt })
const filler = (n, gt, gid) => Array.from({ length: n }, () => rec(gt, gid, '20000', '轻锥', 3))

test('concurrent banners share pity and guarantee but are judged by gacha_id', () => {
  const r = new Map([['11', [
    ...filler(9, '11', '2001'), rec('11', '2001', '1003', '姬子'),   // lose on A
    rec('11', '2002', '1003', '姬子'),                                 // guaranteed on B (standard char as UP)
    rec('11', '2001', '1205', '刃'),                                   // win on A
  ]]])
  const p = judge(r, data).pools['11']
  assert.deepEqual(p.fives.map(f => [f.result, f.pity, f.gachaId]), [['lose', 10, '2001'], ['guaranteed', 1, '2002'], ['win', 1, '2001']])
  assert.deepEqual(p.fives[0].up, ['刃'])
})

test('a standard character on her own rate-up is a win, elsewhere a loss', () => {
  const r = new Map([['11', [rec('11', '2002', '1003', '姬子'), rec('11', '2001', '1003', '姬子'), rec('11', '2001', '1205', '刃')]]])
  assert.deepEqual(judge(r, data).pools['11'].fives.map(f => f.result), ['win', 'lose', 'guaranteed'])
})

test('collab warp keeps its own pity and guarantee', () => {
  const r = new Map([
    ['11', [rec('11', '2001', '1003', '姬子')]],                                // lose on regular banner
    ['21', [...filler(4, '21', '5001'), rec('21', '5001', '1014', 'Saber')]],  // collab: fresh 50/50
  ])
  const { pools } = judge(r, data)
  assert.equal(pools['11'].guaranteed, true)
  assert.deepEqual(pools['21'].fives.map(f => [f.result, f.pity]), [['win', 5]])
})

test('light cones: 75/25 then guaranteed; unknown gacha_id is reported', () => {
  const r = new Map([['12', [rec('12', '3001', '23000', '银河铁道之夜'), rec('12', '3001', '23014', '于夜色中'), rec('12', '3999', '23014', '于夜色中')]]])
  const { pools, issues } = judge(r, data)
  assert.deepEqual(pools['12'].fives.map(f => f.result), ['off', 'up_guaranteed', 'unknown'])
  assert.equal(issues.length, 1)
})

test('standard warp has no verdict', () => {
  const r = new Map([['1', [...filler(30, '1', '1001'), rec('1', '1001', '1003', '姬子')]]])
  assert.deepEqual(judge(r, data).pools['1'].fives.map(f => [f.result, f.pity]), [['standard', 31]])
})

test('luck helpers for Star Rail rules', () => {
  const lc = pityModel('lightcone')
  assert.ok(Math.abs(100 / lc.mean - 1.87) < 0.02, `light cone consolidated rate ${100 / lc.mean}`)
  assert.ok(Math.abs(expectedUpAverage('character').post - 93.4) < 0.2)
  assert.ok(Math.abs(expectedUpAverage('lightcone').post - 66.8) < 0.2)
  const f = fiftyLuck([{ result: 'up' }, { result: 'off' }, { result: 'up_guaranteed' }], 'lightcone')
  assert.deepEqual([f.w, f.n], [1, 2])
  assert.ok(Math.abs(f.expected - 1.5) < 1e-12)
  assert.equal(tierOf(speedLuck('character', 100, 5000).top), 'blessed')
  assert.equal(upAverage({ fives: [{ result: 'off', pity: 60 }, { result: 'up_guaranteed', pity: 40 }] }).avg, 100)
  assert.equal(winRate([{ result: 'win' }, { result: 'lose' }]).n, 2)
})

test('banner metrics: completed runs, open runs, full pity and extremes', async () => {
  const { bannerSpeed, bannerEfficiency, fullPityLuck, extremesLuck, upCosts } = await import('../src/renderer/luck.js')
  const f = (pity, result) => ({ pity, result, time: '2024-01-01', id: String(seq++), name: 'x' })
  assert.ok(bannerSpeed('character', [f(89, 'win')]).top > 0.99, 'one 5★ at 89 is the worst case')
  assert.ok(bannerEfficiency('character', [f(70, 'win'), f(80, 'lose')]).top > bannerEfficiency('character', [f(70, 'win')]).top)
  const fives = [f(80, 'lose'), f(78, 'guaranteed'), f(10, 'win')]
  assert.deepEqual(upCosts(fives).costs.map(c => c.cost), [158, 10])
  assert.equal(fullPityLuck('character', fives).k, 1)
  const ex = extremesLuck('character', fives)
  assert.deepEqual([ex.worst.cost, ex.best.cost], [158, 10])
  // the same 60 pulls per rate-up is luckier on a character banner (expected ~93) than on light cones (~67)
  assert.ok(bannerEfficiency('character', [f(60, 'win')]).top < bannerEfficiency('lightcone', [f(60, 'up')]).top)
})
