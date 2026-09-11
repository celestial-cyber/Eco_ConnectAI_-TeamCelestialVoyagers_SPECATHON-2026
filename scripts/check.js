#!/usr/bin/env node
/* ============================================================
   npm run check                 — test everything with a generated image
   npm run check -- photo.jpg    — test with your own photo
   npm run check -- --models     — just list the models your key can use

   Runs outside the web app so you can see exactly what the provider
   said, with no UI in the way.
   ============================================================ */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname } from 'node:path'

// .env is not auto-loaded by node — read it the same way the server would
loadEnv()

const args = process.argv.slice(2)
const wantModels = args.includes('--models')
const file = args.find((a) => !a.startsWith('-'))

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
}
const line = () => console.log(c.dim('─'.repeat(64)))
let failures = 0

console.log('')
console.log(c.b('  EcoConnect AI — environment check'))
line()

/* ---------------- 1. vision ---------------- */
const vision = await import('../server/vision.js')

console.log(c.b('\n  1. VISION'))
if (!vision.hasVision) {
  failures++
  console.log(`  ${c.bad('✗')} No vision provider configured.`)
  console.log(c.dim('    Set one of these in .env, then run this again:\n'))
  console.log(c.dim('      GEMINI_API_KEY=...            # Google AI Studio'))
  console.log(c.dim('      OPENAI_API_KEY=...            # OpenAI'))
  console.log(c.dim('      OPENAI_API_KEY=...            # or any OpenAI-compatible provider,'))
  console.log(c.dim('      OPENAI_BASE_URL=https://api.groq.com/openai/v1'))
  console.log(c.dim('      OPENAI_BASE_URL=http://localhost:11434/v1   # local Ollama'))
} else {
  console.log(`  provider  ${c.b(vision.provider)}`)
  console.log(`  model     ${c.b(vision.modelName)}`)

  // what can this key actually run?
  try {
    const models = await vision.listModels()
    const listed = models.length
    const has = models.includes(vision.modelName)
    console.log(`  ${c.ok('✓')} endpoint reachable — ${listed} model${listed === 1 ? '' : 's'} available`)
    if (!has && listed) {
      console.log(`  ${c.warn('!')} "${vision.modelName}" is not in that list. Candidates:`)
      const hint = models.filter((m) => /vision|flash|mini|luna|terra|astra|4o|gpt|gemini|llava|qwen/i.test(m))
      for (const m of (hint.length ? hint : models).slice(0, 12)) console.log(c.dim(`      ${m}`))
      console.log(c.dim(`    Set GEMINI_MODEL / OPENAI_MODEL in .env to one of these.`))
    }
    if (wantModels) {
      console.log(c.dim('\n    All models:'))
      for (const m of models) console.log(c.dim(`      ${m}`))
      process.exit(0)
    }
  } catch (e) {
    console.log(`  ${c.warn('!')} could not list models: ${e.message}`)
    if (wantModels) process.exit(1)
  }

  // real classification
  const { buffer, mime, label } = file ? fromFile(file) : generated()
  console.log(c.dim(`  sending   ${label} (${(buffer.length / 1024).toFixed(0)} KB)`))
  const t0 = Date.now()
  try {
    const r = await vision.classifyBuffer(buffer, mime)
    const ms = Date.now() - t0
    console.log(`  ${c.ok('✓')} answered in ${ms} ms\n`)
    for (const [k, v] of Object.entries(r)) {
      console.log(`      ${k.padEnd(14)} ${typeof v === 'number' ? v : String(v)}`)
    }
    if (r.unclear) {
      console.log(`\n  ${c.warn('!')} waste_type came back "unclear" — expected for a synthetic`)
      console.log(c.dim('    test image. Re-run with a real photo: npm run check -- photo.jpg'))
    }
  } catch (e) {
    failures++
    console.log(`  ${c.bad('✗')} ${e.message}`)
  }
}

/* ---------------- 2. location ---------------- */
console.log(c.b('\n  2. LOCATION'))
const geo = await import('../server/geo.js')
const spots = [
  ['Hitec City, Hyderabad', 17.4485, 78.3908],
  ['Gachibowli, Hyderabad', 17.4401, 78.3489],
]
for (const [name, lat, lng] of spots) {
  const t0 = Date.now()
  const r = await geo.reverseGeocode(lat, lng)
  const ms = Date.now() - t0
  if (r.degraded) {
    failures++
    console.log(`  ${c.bad('✗')} ${name}`)
    console.log(c.dim(`      geocoder unreachable: ${r.reason}`))
    console.log(c.dim(`      the app still works — pickups save with raw coordinates`))
  } else {
    console.log(`  ${c.ok('✓')} ${lat}, ${lng} ${c.dim('→')} ${c.b(r.address)} ${c.dim(`(${ms} ms${r.cached ? ', cached' : ''})`)}`)
  }
}

/* ---------------- 3. database ---------------- */
console.log(c.b('\n  3. DATABASE'))
try {
  const { db, seedIfEmpty } = await import('../server/db.js')
  const seeded = seedIfEmpty()
  const counts = ['profiles', 'industries', 'delivery_agents', 'pickups', 'runs']
    .map((t) => `${t}=${db.prepare(`select count(*) c from ${t}`).get().c}`)
    .join('  ')
  console.log(`  ${c.ok('✓')} ${process.env.DB_FILE || 'data/ecoconnect.db'}${seeded ? c.dim(' (seeded now)') : ''}`)
  console.log(c.dim(`      ${counts}`))
} catch (e) {
  failures++
  console.log(`  ${c.bad('✗')} ${e.message}`)
}

line()
if (failures) {
  console.log(`  ${c.bad(`${failures} check${failures === 1 ? '' : 's'} failed`)} — see above.\n`)
  process.exit(1)
}
console.log(`  ${c.ok('all good')} — start the app with ${c.b('npm run dev')}\n`)

/* ---------------- helpers ---------------- */

function fromFile(p) {
  const path = resolve(p)
  if (!existsSync(path)) {
    console.log(`\n  ${c.bad('✗')} No such file: ${path}\n`)
    process.exit(1)
  }
  const ext = extname(path).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return { buffer: readFileSync(path), mime, label: p }
}

/** A tiny valid PNG so the check works with no photo to hand. */
function generated() {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAXklEQVR42u3PQREAAAgDoK1/aM3g' +
    'B4dAcnbVdMAECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAg' +
    'QIAAAQIECBAgQIAAAQIECBAgQIDACwNSAAGnHOFVAAAAAElFTkSuQmCC'
  return {
    buffer: Buffer.from(png, 'base64'),
    mime: 'image/png',
    label: 'a generated 64×64 test image',
  }
}

/** Minimal .env reader — no dependency, same keys the server uses. */
function loadEnv() {
  const path = resolve('.env')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const l = raw.trim()
    if (!l || l.startsWith('#')) continue
    const i = l.indexOf('=')
    if (i < 1) continue
    const k = l.slice(0, i).trim()
    let v = l.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (v && process.env[k] === undefined) process.env[k] = v
  }
}
