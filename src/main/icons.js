// Character / light cone icons, fetched on demand from Mar-7th/StarRailRes (AGPL-3.0, so
// not bundled) and cached next to the app in userData/icons. They are HoYoverse game
// assets either way.
const { ipcMain } = require('electron')
const fetch = require('electron-fetch').default
const path = require('path')
const fs = require('fs-extra')
const { userDataPath } = require('./utils')

const cacheDir = path.join(userDataPath, 'icons')
// jsDelivr first: raw.githubusercontent.com is often unreachable from mainland China
const SOURCES = [
  'https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master',
  'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master',
]
const SAFE_ID = /^\d{4,6}$/
const failed = new Set()   // don't hammer the network for ids that 404 this session

// Image type from the file signature; the extension can't be trusted.
function sniff(buf) {
  if (!buf || buf.length < 12) return null
  if (buf.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  return null
}

async function download(id, folder) {
  for (const base of SOURCES) {
    try {
      const res = await fetch(`${base}/icon/${folder}/${id}.png`, { timeout: 15000 })
      if (!res.ok) continue
      const buf = await res.buffer()
      // must really be an image, so an HTML error page never lands in the cache
      if (sniff(buf)) return buf
    } catch (e) { /* try next source */ }
  }
  return null
}

async function getIcon(id, type, offline) {
  if (!SAFE_ID.test(id)) return null
  const file = path.join(cacheDir, `${id}.png`)
  try {
    return await fs.readFile(file)
  } catch (e) { /* not cached */ }
  if (offline || failed.has(id)) return null
  // item ids: 4 digits = character (small 'avatar' icon), 5 = light cone
  const buf = await download(id, id.length >= 5 ? 'light_cone' : 'avatar')
  if (!buf) { failed.add(id); return null }
  await fs.outputFile(file, buf)
  return buf
}

// items: [{ id }] (item_id from the records) -> { id: dataURL }
// offline: only return what is already cached (instant), so the UI can show those first
ipcMain.handle('GET_ICONS', async (event, items, { offline = false } = {}) => {
  const out = {}
  const queue = [...new Map((items || []).map(i => [i.id, i])).values()]
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const buf = await getIcon(item.id, item.t, offline)
      const mime = sniff(buf)
      if (mime) out[item.id] = `data:${mime};base64,${buf.toString('base64')}`
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return out
})
