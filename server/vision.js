/* ============================================================
   Server-side vision. Keys live here and only here — never in a
   browser bundle.

   Two providers, picked by whichever key is set:

     GEMINI_API_KEY   -> Google Gemini
     OPENAI_API_KEY   -> anything speaking the OpenAI chat API:
                         OpenAI, Groq, OpenRouter, Together, or a
                         local Ollama / LM Studio via OPENAI_BASE_URL.

   Force one with VISION_PROVIDER=gemini|openai.
   ============================================================ */

const GEMINI_KEY = process.env.GEMINI_API_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')

const forced = process.env.VISION_PROVIDER
export const provider =
  forced || (GEMINI_KEY ? 'gemini' : OPENAI_KEY ? 'openai' : null)

// Model IDs move. gemini-2.0-flash was shut down; these are current defaults.
// A custom OPENAI_BASE_URL (Groq, Ollama, …) serves different names, so set
// OPENAI_MODEL yourself there — `npm run check` lists what your endpoint offers.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6-astra'

export const hasVision = Boolean(provider && (provider === 'gemini' ? GEMINI_KEY : OPENAI_KEY))
export const modelName = provider === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL
export const describeVision = () => (hasVision ? `${provider}:${modelName}` : null)

export const WASTE_IDS = [
  'textile', 'paper', 'e-waste', 'plastic', 'metal', 'glass', 'furniture', 'organic',
]

const PROMPT = `You are the intake classifier for a waste-recovery platform.
Look at the photograph and identify the single main discarded item in it.

Return strict JSON only, with these keys:
- item_label: a short human name for the item, 2-4 words, sentence case (e.g. "Cardboard cartons").
- waste_type: exactly one of ${WASTE_IDS.join(', ')} — or "unclear".
- condition: 0-10, how much usable life is left. 9-10 nearly new, 6-8 good and reusable,
  3-5 worn but repairable or recyclable, 0-2 only fit for material recovery.
- pathway: one of "REUSABLE · DONATE", "REPAIRABLE · REFURBISH", "RECYCLABLE", "NOT RECOVERABLE".
- confidence: 0-100, how sure you are of item_label and waste_type.
- est_weight_kg: a realistic single-item weight in kilograms.

If the photo does not show a discardable object at all — a person, a screen, a document,
a page of handwriting, a blank wall — set waste_type to "unclear", confidence below 40, and
say what you actually see in item_label. Never guess a plausible-sounding object that is not
in the picture.`

const PROPS = {
  item_label: { type: 'string' },
  waste_type: { type: 'string', enum: [...WASTE_IDS, 'unclear'] },
  condition: { type: 'number' },
  pathway: { type: 'string' },
  confidence: { type: 'number' },
  est_weight_kg: { type: 'number' },
}
const REQUIRED = Object.keys(PROPS)

const err = (msg, status = 502) => Object.assign(new Error(msg), { status })

/* ------------------------------------------------------------------ */
export async function classifyBuffer(buffer, mimeType = 'image/jpeg') {
  if (!hasVision) {
    throw err(
      'No vision model configured on the server. Set GEMINI_API_KEY or OPENAI_API_KEY in .env, then restart.',
      503
    )
  }
  const raw = provider === 'gemini'
    ? await viaGemini(buffer, mimeType)
    : await viaOpenAI(buffer, mimeType)
  return normalise(raw)
}

/* ---------------- Gemini ---------------- */
async function viaGemini(buffer, mimeType) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`
  const res = await post(url, {
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
      ],
    }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(PROPS).map(([k, v]) => [k, { ...v, type: v.type.toUpperCase() }])
        ),
        required: REQUIRED,
      },
      temperature: 0.1,
    },
  })

  if (!res.ok) throw geminiError(res)
  const text = res.json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
  if (!text) throw err('Gemini returned nothing — the image may have been blocked by a safety filter.')
  return parse(text)
}

function geminiError(res) {
  const detail = res.json?.error?.message || ''
  if (res.status === 404) {
    return err(`Model "${GEMINI_MODEL}" not found. Run \`npm run check\` to list what your key can use, then set GEMINI_MODEL.`)
  }
  if (res.status === 429) return err('Gemini rate limit hit. Wait a moment and retry.', 429)
  if (/API key/i.test(detail)) return err('Gemini rejected the API key. Check GEMINI_API_KEY.')
  return err(detail || `Gemini returned ${res.status}.`)
}

/* ---------------- OpenAI-compatible ---------------- */
async function viaOpenAI(buffer, mimeType) {
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
      ],
    }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'waste_item',
        strict: true,
        schema: { type: 'object', properties: PROPS, required: REQUIRED, additionalProperties: false },
      },
    },
  }

  let res = await post(`${OPENAI_BASE}/chat/completions`, body, {
    authorization: `Bearer ${OPENAI_KEY}`,
  })

  // Not every OpenAI-compatible server supports json_schema (Ollama, older
  // proxies). Fall back to plain JSON mode rather than failing the request.
  if (!res.ok && res.status === 400 && /json_schema|response_format|schema/i.test(rawText(res))) {
    res = await post(
      `${OPENAI_BASE}/chat/completions`,
      { ...body, response_format: { type: 'json_object' } },
      { authorization: `Bearer ${OPENAI_KEY}` }
    )
  }

  if (!res.ok) throw openaiError(res)
  const text = res.json?.choices?.[0]?.message?.content ?? ''
  if (!text) throw err('The model returned an empty message.')
  return parse(text)
}

function openaiError(res) {
  const detail = res.json?.error?.message || rawText(res)
  if (res.status === 401) return err(`${OPENAI_BASE} rejected the API key. Check OPENAI_API_KEY.`)
  if (res.status === 404 || /model/i.test(detail)) {
    return err(`Model "${OPENAI_MODEL}" was not accepted by ${OPENAI_BASE}. Run \`npm run check\` to list available models, then set OPENAI_MODEL.`)
  }
  if (res.status === 429) return err('Rate limit or quota hit at the provider.', 429)
  return err(detail || `Provider returned ${res.status}.`)
}

/* ---------------- shared plumbing ---------------- */
async function post(url, body, extraHeaders = {}) {
  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (e) {
    throw err(
      e.name === 'TimeoutError'
        ? 'The vision model did not answer within 45 seconds.'
        : `Could not reach the vision provider: ${e.message}`,
      504
    )
  }
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { ok: r.ok, status: r.status, json, text }
}

const rawText = (res) => (res.text || '').slice(0, 300)

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    // some models wrap JSON in a ```json fence despite being told not to
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {}
    }
    throw err('The model did not return valid JSON.')
  }
}

/** Never trust the model's shape. Clamp before anything reaches the database. */
function normalise(r) {
  const type = WASTE_IDS.includes(r.waste_type) ? r.waste_type : null
  const num = (v, lo, hi, dflt) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
  }
  return {
    item_label: String(r.item_label ?? 'Unidentified item').slice(0, 80),
    waste_type: type,
    unclear: !type,
    condition: num(r.condition, 0, 10, 5),
    pathway: String(r.pathway ?? 'RECYCLABLE').slice(0, 40),
    confidence: num(r.confidence, 0, 100, 0),
    est_weight_kg: Math.max(0.1, num(r.est_weight_kg, 0.1, 500, 1)),
    provider,
    model: modelName,
  }
}

/**
 * Ask the configured endpoint what it can actually run.
 * Used by `npm run check` so nobody has to guess a model ID.
 */
export async function listModels() {
  if (provider === 'gemini') {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}&pageSize=200`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!r.ok) throw err(`Could not list Gemini models (${r.status}).`)
    const j = await r.json()
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
  }
  if (provider === 'openai') {
    const r = await fetch(`${OPENAI_BASE}/models`, {
      headers: { authorization: `Bearer ${OPENAI_KEY}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) throw err(`Could not list models from ${OPENAI_BASE} (${r.status}).`)
    const j = await r.json()
    return (j.data || []).map((m) => m.id)
  }
  return []
}
