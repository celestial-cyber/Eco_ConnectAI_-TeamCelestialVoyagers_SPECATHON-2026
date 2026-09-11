# EcoConnect AI

A multimodal computer-vision and geospatial NGO matchmaker for circular waste management.
Team Celestial Voyager · St. Peter's Engineering College · SPEC'THON 2026.

```
Landing page ──► Login / Sign up ──► Main app
                       │
                       └─ Sign up ─► Register entry ─┬─► NGO / Industry
                                                     ├─► Delivery agent
                                                     └─► User (donor)
```

Full stack: a React SPA, an Express API, a SQLite database, JWT auth, real device GPS,
real OpenStreetMap maps, a live camera, and your own vision model called from the server.

---

## Run it

```bash
npm install
npm run dev      # API on :8787 and web on :5173, together
```

Open **http://localhost:5173** for the landing film and
**http://localhost:5173/app.html** for the app.

No configuration is required. On first boot the server creates `data/ecoconnect.db`,
seeds it, and runs the matcher so the demo opens in a believable state.

| Email | Password | Role |
|---|---|---|
| `donor@demo.in` | `demo1234` | Donor — scans and uploads items |
| `industry@demo.in` | `demo1234` | Goonj Collection Hub — textile / paper / furniture |
| `driver@demo.in` | `demo1234` | Agent `ECO-DA-HYD-4821`, Tata Ace, 750 kg |
| `admin@demo.in` | `demo1234` | Verification desk |

Other commands:

```bash
npm run check     # verify your AI key, geocoding and database
npm test          # 33 tests: the batching engine, and the API end to end
npm run build     # SPA into dist/
npm start         # one process: API + the built SPA, for deployment
```

Delete `data/` to reset everything.

---

## Architecture

```
browser ─┬─ React SPA (Vite)  ─── fetch /api ──►  Express  ─┬─ SQLite  (better-sqlite3)
         ├─ getUserMedia (camera)                           ├─ your vision model (key server-side)
         └─ navigator.geolocation (GPS)                     ├─ Nominatim (cached, rate-limited)
                                                            └─ node-cron (batching pass)
```

**The browser holds no secrets and makes no decisions.** Matching, batching, agent assignment
and minting eco points all happen on the server. The client cannot award itself points, close
someone else's run, or read another organisation's queue — every one of those is a test.

`src/lib/batching.js` is imported by **both** the server and the unit tests, so the algorithm
that runs in production is the one that is covered.

---

## What is real

**Camera.** `getUserMedia` with a live preview, a framing guide, front/back switching, and a
shutter that grabs a frame, downscales it to 1280 px and uploads it. Browsers only grant a
camera over HTTPS or on localhost — on a phone over plain http you get a clear message and the
file picker, not a dead button.

**Location.** `navigator.geolocation` with a real accuracy reading (`±18 m — good fix`), then a
server-side reverse geocode to a street address. Denied, unavailable, timed out and
insecure-context each get their own message, and the pin is always draggable on the map as the
way through. If the geocoder is unreachable the pickup still saves with its coordinates as the
address — a slightly ugly address beats a lost pickup.

**Maps.** Leaflet with OpenStreetMap data on a CARTO dark basemap: markers, catchment circles,
and the optimised route drawn stop by stop. Set `VITE_TILE_URL` to use another provider.

**Vision.** Your own model, called from the server so the key is never in the bundle — Gemini,
OpenAI, or anything OpenAI-compatible including a local one. See *Bring your own AI* below.

---

## Bring your own AI

The key lives on the **server** and never reaches a browser. Two providers, picked by
whichever key you set:

```bash
# .env  — Option A: Google Gemini
GEMINI_API_KEY=...
GEMINI_MODEL=            # default gemini-3.7-flash

# .env  — Option B: OpenAI, or anything speaking the same API
OPENAI_API_KEY=...
OPENAI_BASE_URL=         # default https://api.openai.com/v1
OPENAI_MODEL=            # default gpt-6-astra
```

Because option B is just the OpenAI chat API, it also covers **Groq**
(`https://api.groq.com/openai/v1`), **OpenRouter** (`https://openrouter.ai/api/v1`) and a
**local model** with no key leaving your machine at all (`http://localhost:11434/v1` for
Ollama). Set `VISION_PROVIDER=gemini|openai` if both keys are present.

### Test it in one command

```bash
npm run check                    # generated test image
npm run check -- photo.jpg       # your own photo — the real test
npm run check -- --models        # list the models your key can actually run
```

It prints the provider, confirms the endpoint is reachable, warns if your model ID is not in
the list your key can use (with candidates), sends a real image, and prints exactly what came
back — plus a live reverse-geocode and the database row counts. **Model IDs move**, so nothing
is guessed: `--models` asks your endpoint.

```
  1. VISION
  provider  openai
  model     gpt-6-astra
  ✓ endpoint reachable — 84 models available
  sending   photo.jpg (412 KB)
  ✓ answered in 1840 ms

      item_label     Cardboard cartons
      waste_type     paper
      condition      6.4
      confidence     94
      est_weight_kg  4.2
```

### Guardrails

The prompt asks for structured JSON against a schema at low temperature, and instructs the
model to answer `waste_type: "unclear"` rather than name a plausible object it cannot see.
`server/vision.js` then clamps every field before it can reach the database — an unknown
category or an out-of-range condition cannot get through. If an OpenAI-compatible endpoint
rejects `json_schema` (Ollama, older proxies) it retries in plain JSON mode instead of failing.

With **no** key set the app does not guess: it says so and asks the donor to describe the item.
An earlier build guessed from a fixed list and called a photo of paper "Wooden chair" at 89%
confidence — a confident wrong answer is worse than no answer.

### Testing location

The same `npm run check` reverse-geocodes two known coordinates and prints the addresses. In
the browser the donor's scan page requests real GPS and shows the accuracy it got; the pin is
draggable either way. Note that **browsers only grant GPS and camera over HTTPS or on
localhost** — over `http://<your-ip>:5173` from a phone both are blocked by the browser, not
by this app.

---

## The batching engine

`src/lib/batching.js` — pure functions, no network, no React.
This is the part of the spec that does real work.

**Clustering.** Matched pickups are grouped by destination industry, then by geography: seed
with the longest-waiting item and absorb anything within `CLUSTER_RADIUS_KM` of the running
centroid, up to `MAX_STOPS`.

**Triggering.** A cluster leaves when any one of these is true:

| Rule | Default | Why |
|---|---|---|
| `MIN_BULK_KG` | 40 kg | Enough load to justify a van |
| `MIN_STOPS` | 4 | Many light items are also worth a trip |
| `MAX_WAIT_HOURS` | 6 h | Nothing waits forever in a quiet area |
| `MAX_STOPS` | 8 | Ceiling, so one agent is never buried |

The wait limit matters: without it a donor in a low-volume area would never be collected.

**Ordering.** Nearest-neighbour seed from the agent's base, then 2-opt on the open path
`base → stops → industry`.

**Saving.** Every run records what those pickups would have cost as separate trips
(`base → pickup → industry → base`, summed) against the batched route. The seeded demo comes
out at **12.5 km batched against 63.9 km solo — 80% of the driving avoided.** Measured, not
asserted.

**Assignment.** Nearest on-duty agent whose van capacity covers the load and whose registered
radius reaches the cluster centre. If nobody qualifies the cluster stays queued and the queue
page says which of the two reasons applies.

The pass runs on a cron (`BATCH_CRON`, default every 2 minutes). The button in the industry
portal runs it immediately so you can watch it happen on stage.

---

## Roles

**Donor (`/u`)** — camera or photo → category, condition and pathway → GPS location →
matched to a verified industry that accepts that material *and* has enrolled that area.
Points are credited only when the handover is verified, never at request time.

**Industry / NGO (`/i`)** — a five-step registration wizard (identity, location, target trash,
areas served, review) with a map pin instead of latitude fields. **Unverified organisations
receive nothing.** The incoming queue explains why anything is still waiting.

**Delivery agent (`/d`)** — three-step registration; a code such as `ECO-DA-HYD-4821` is issued
on registration and is what an industry checks at the gate. Runs arrive already batched, with
the stop order, the load, and what the same pickups would have cost separately. The drop is
confirmed with the run's handover code — a wrong code is refused by the server.

**Verification desk (`/a`)** — a separate role that approves or rejects registrations, with a
required note on rejection. An applicant approving itself would make the whole verified/unverified
rule meaningless, so the API refuses it (`403`, and there is a test for it).

Shared: **Notifications** and the **Hub feed**, written by the delivery path, not by the client.

---

## Configuration

Everything is optional — copy `.env.example` to `.env` and fill in what you need.

| Variable | Effect |
|---|---|
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Turns on real classification. Server-side only. |
| `GEMINI_MODEL` | Default `gemini-3.7-flash`. `gemini-2.0-flash` has been shut down. |
| `JWT_SECRET` | Set in production; otherwise a dev secret is written to `data/.jwt-secret`. |
| `GEOCODE_USER_AGENT` | Nominatim requires a real contact. Put yours here. |
| `BATCH_CRON` | Batching schedule, or `off`. |
| `VITE_TILE_URL` | Map tile template. |
| `VITE_API_URL` | Only if the API is on another origin. |

**Deploying.** `npm run build && npm start` serves the SPA and the API from one process on
`PORT`. Give the host a persistent volume for `data/` (SQLite plus uploaded photos), set
`JWT_SECRET` and `GEMINI_API_KEY`, and serve it over HTTPS — the camera and GPS both require it.

---

## Testing

```bash
npm test
```

33 tests. The engine tests cover clustering, all three triggers, 2-opt, van capacity, service
radius and the matching rules. The API tests boot a real server against a throwaway database
and assert the things that would actually hurt: anonymous access is refused, a donor cannot
reach industry endpoints, one industry cannot read another's pickups, an agent cannot touch a
run that is not theirs, a wrong handover code does not close a run, an applicant cannot verify
itself, and approving a pending organisation rematches what was queued behind it.

The whole app was also driven in headless Chromium with a synthetic camera and injected
coordinates, through all four roles.

---

## Known gaps

- **Photos are stored on disk, unencrypted**, under `data/uploads`, served only to the donor,
  the matched industry and the assigned agent. Fine for a demo; a real deployment wants object
  storage with signed URLs.
- **The handover code is typed, not scanned.** The run carries a token and the server checks
  it; rendering it as a QR and scanning it with the agent's camera is a small addition on top.
- **No live driver tracking.** Runs move through their states manually.
- **Nominatim is a courtesy service.** The proxy caches and rate-limits to stay inside its
  policy, but a real deployment should pay for a geocoder.
- **SQLite is one file.** Fine to a few thousand pickups and trivial to back up; swap
  `server/db.js` for Postgres when that stops being true.

## Layout

```
server/index.js         routes, auth wiring, cron, static build
server/db.js            schema, seed, read helpers
server/auth.js          JWT, bcrypt, role and ownership guards
server/ops.js           matching, batching pass, delivery (mints points)
server/vision.js        Gemini, server-side, with clamping
server/geo.js           reverse geocoding: cache + rate limit
src/lib/batching.js     the engine — shared with the server and the tests
src/lib/db.js           API client
src/hooks/useGeolocation.js
src/components/Camera.jsx · MapPlot.jsx · LocationPicker.jsx
src/pages/              Auth, User, Industry, Delivery, Admin, Shared
scripts/check.js        one-command environment check
tests/                  batching.test.js · api.test.js
```
#   E c o _ C o n n e c t A I _ - T e a m C e l e s t i a l V o y a g e r s _ S P E C A T H O N - 2 0 2 6  
 