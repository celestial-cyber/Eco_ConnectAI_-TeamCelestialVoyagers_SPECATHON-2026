# EcoConnect AI

> **AI-powered waste-to-value infrastructure for circular waste management.**

**Team Celestial Voyager · St. Peter's Engineering College · SPEC'THON 2026**

EcoConnect AI connects people who want to responsibly dispose of waste with the organizations that can **reuse, refurbish, donate, recycle, and recover value from it**.

Instead of treating every discarded item as generic waste, EcoConnect uses multimodal AI, geospatial matching, pickup coordination, verification, and impact tracking to create an end-to-end recovery pathway.

---

## 🌍 The Problem

Waste management is not only a disposal problem — it is a **coordination and value-discovery problem**.

A person with an old laptop, phone, piece of furniture, or other recyclable material may not know:

* What exactly the item is
* Whether it can be reused, refurbished, donated, or recycled
* Whether the item has recoverable economic value
* Which organization accepts that specific material
* Whether pickup is available in their area
* What happens to the item after collection

At the same time, NGOs, recyclers, refurbishers, and collection organizations need the **right material, in the right location, at the right time**.

### Our insight

> **The waste sitting around us is not simply garbage. It is an untapped secondary resource.**

EcoConnect bridges the gap between people who have waste and organizations that can recover its value.

---

# 💡 Our Solution

EcoConnect provides a complete **waste-to-value workflow**:

```text
SCAN
  ↓
IDENTIFY
  ↓
ASSESS CONDITION
  ↓
ESTIMATE RECOVERY POTENTIAL
  ↓
CHOOSE PATHWAY
  ↓
MATCH WITH ORGANIZATION
  ↓
COORDINATE PICKUP
  ↓
VERIFY HANDOVER
  ↓
RECOVER VALUE
```

The platform supports four primary recovery pathways:

| Pathway          | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| ♻️ **Reuse**     | Keep a functional item in use                         |
| 🔧 **Refurbish** | Repair or upgrade an item for another user            |
| 🤝 **Donate**    | Route usable items to suitable organizations          |
| ♻️ **Recycle**   | Send non-reusable material to an appropriate recycler |

The core idea is simple:

> **Don't just ask where waste should go. Understand what it is, what can be recovered from it, and who can recover it.**

---

# 🏗️ System Architecture

EcoConnect is a full-stack application combining a React frontend, Express backend, SQLite persistence, server-side AI, geospatial services, authentication, and pickup batching.

```text
┌─────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                       │
│                    React SPA + Vite                        │
│                                                             │
│  Camera │ GPS │ Maps │ Auth │ Dashboards │ Pickup Status    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              │ REST API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         EXPRESS API                         │
│                                                             │
│  Authentication │ Authorization │ Matching │ Pickup Ops     │
│  Verification   │ Notifications │ Delivery │ Vision        │
└───────────────┬─────────────────┬─────────────────┬─────────┘
                │                 │                 │
                ▼                 ▼                 ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │    SQLite    │  │  Vision AI   │  │ Geospatial   │
        │ better-sqlite│  │ Server-side  │  │  Nominatim   │
        │      3       │  │   analysis   │  │ + Leaflet    │
        └──────────────┘  └──────────────┘  └──────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │ Batching Engine  │
                     │  Clustering      │
                     │  Route Ordering  │
                     │  Agent Assignment│
                     └──────────────────┘
```

## Application Flow

```text
Landing Page
     │
     ▼
Login / Sign Up
     │
     ├──► User / Donor
     │       └──► Scan → Pickup → Verification → Points
     │
     ├──► NGO / Industry
     │       └──► Register → Verification → Incoming Queue
     │
     └──► Delivery Agent
             └──► Register → Assigned Runs → Handover
```

---

# ✨ Key Features

## 1. 🤖 AI-Powered Waste Identification

The donor can capture an image using the device camera or upload a photograph.

The server-side vision model attempts to identify:

* Item label
* Waste category
* Condition
* Confidence score
* Estimated weight
* Recovery pathway

The system is designed to avoid confidently inventing an answer when the item cannot be reliably identified.

If no AI key is configured, the application does not make an unsupported classification. Instead, it asks the donor to describe the item.

### Why server-side AI?

API credentials never enter the browser bundle.

```text
Browser
   │
   │ Image
   ▼
Express API
   │
   │ Secure server-side request
   ▼
Vision Provider
```

Supported provider styles include Gemini and OpenAI-compatible APIs, including compatible gateways or local model endpoints.

---

# 2. 🔍 Condition & Recovery Assessment

A category alone is not enough.

For example, two laptops may both be classified as **e-waste**, but their recovery pathways can be completely different.

One may be:

```text
Functional
   ↓
Reusable
   ↓
Resale / Donation
```

While another may be:

```text
Non-functional
   ↓
Not economically repairable
   ↓
Parts Recovery / Recycling
```

EcoConnect therefore considers the item's condition and recovery potential before recommending the next step.

```text
                    ┌──► REUSE
                    │
Identified Item ────┼──► REFURBISH
                    │
                    ├──► DONATE
                    │
                    └──► RECYCLE
```

This creates the foundation for a future **waste valuation engine** that can separately consider:

* Resale value
* Refurbishment potential
* Parts value
* Material recovery value
* Collection cost
* Processing cost
* Expected net recovery value

---

# 3. 📍 Geospatial Organization Matching

EcoConnect does not simply search for the nearest organization.

The matching process considers:

* Waste/material category accepted
* Organization verification status
* Service area
* Geographic proximity
* Pickup capability
* Availability

The donor's location is obtained through browser geolocation and can be adjusted using a draggable map pin.

Reverse geocoding converts coordinates into a usable address when the geocoding service is available.

---

# 4. 📷 Real-Time Camera

The application uses the browser's `getUserMedia` API to provide:

* Live camera preview
* Framing guide
* Front/back camera switching
* Image capture
* Image resizing before upload

Camera access requires HTTPS or localhost in supported browsers.

---

# 5. 📡 Real-Time GPS

The application uses `navigator.geolocation` to:

* Request the donor's location
* Display location accuracy
* Reverse-geocode coordinates
* Place the pickup on the map
* Allow manual location correction

If GPS or geocoding fails, the pickup can still be saved using the available coordinates.

---

# 6. 🗺️ Interactive Maps

EcoConnect uses Leaflet with OpenStreetMap-compatible map data.

The map supports:

* Organization markers
* Pickup locations
* Catchment areas
* Location selection
* Optimized delivery routes

Map tiles can be changed through the `VITE_TILE_URL` environment variable.

---

# 7. 🚚 Pickup Batching & Route Optimization

A major operational challenge in waste collection is avoiding inefficient individual trips.

EcoConnect includes a batching engine located at:

```text
src/lib/batching.js
```

The engine groups matched pickups geographically and by destination organization.

## Clustering

Pickups are seeded using the longest-waiting item and then grouped around the running centroid within the configured radius.

A batch is limited by a maximum number of stops.

## Trigger Conditions

A batch is released when one of the following conditions is met:

| Rule             | Default | Purpose                                     |
| ---------------- | ------: | ------------------------------------------- |
| `MIN_BULK_KG`    |   40 kg | Creates a sufficiently useful load          |
| `MIN_STOPS`      |       4 | Allows several small pickups to be combined |
| `MAX_WAIT_HOURS` |     6 h | Prevents indefinite waiting                 |
| `MAX_STOPS`      |       8 | Prevents oversized runs                     |

The wait limit is important because low-volume areas should not leave donors waiting indefinitely.

## Route Ordering

The system uses:

1. Nearest-neighbour ordering from the agent's base
2. 2-opt route improvement
3. Final destination at the assigned industry/hub

The engine also compares the batched route with estimated individual-trip distance to quantify potential travel reduction.

## Agent Assignment

A batch is assigned to the nearest eligible on-duty agent whose:

* Vehicle capacity can handle the load
* Registered service radius covers the batch
* Current status allows assignment

If no agent qualifies, the batch remains queued with an explanation.

---

# 👥 User Roles

EcoConnect supports four major roles.

## 👤 Donor

The donor workflow is:

```text
Camera / Photo
      ↓
AI Identification
      ↓
Condition & Recovery Pathway
      ↓
GPS Location
      ↓
Verified Organization Match
      ↓
Pickup
      ↓
Verified Handover
      ↓
Eco Points
```

Points are credited only after a verified handover rather than when the pickup request is created.

---

## 🏢 NGO / Industry

Organizations complete a registration workflow covering:

1. Identity
2. Location
3. Target waste/material
4. Areas served
5. Review

Organizations must be verified before receiving eligible incoming work.

The organization dashboard provides an incoming queue and explains why a request may still be waiting.

---

## 🚚 Delivery Agent

Agents register their profile and vehicle.

A unique agent code is issued, for example:

```text
ECO-DA-HYD-4821
```

Assigned runs contain:

* Pickup stops
* Stop order
* Load information
* Destination
* Estimated individual-trip comparison
* Handover information

The final drop is protected by a server-validated handover code.

---

## 🛡️ Verification Desk

The verification role reviews organization registrations and can:

* Approve registrations
* Reject registrations
* Record a rejection note

Self-verification is blocked at the API level.

---

# 🔐 Security & Trust

EcoConnect keeps important business logic on the server.

> **The browser holds no secrets and does not make authoritative decisions.**

Server-side controls include:

* JWT authentication
* Password hashing
* Role-based authorization
* Ownership checks
* Server-side AI calls
* Server-side point minting
* Pickup ownership validation
* Handover-code validation
* Organization verification

Examples:

```text
Donor
  ✕ Cannot access another organization's queue

Industry A
  ✕ Cannot read Industry B's pickups

Agent A
  ✕ Cannot close Agent B's run

Applicant
  ✕ Cannot approve their own organization

Wrong handover code
  ✕ Cannot complete a run
```

---

# 🧠 AI Safety & Guardrails

AI output is treated as untrusted input.

The vision prompt requests structured JSON, while the server validates and clamps the response before it reaches the database.

The system can return:

```json
{
  "waste_type": "unclear"
}
```

when the image does not provide enough evidence.

This is intentional:

> **A transparent "unclear" result is safer than a confident but incorrect classification.**

When an OpenAI-compatible endpoint does not support structured JSON schema output, the vision layer can fall back to plain JSON mode.

---

# 🧪 Testing

Run the complete test suite:

```bash
npm test
```

The project includes tests for the batching engine and API behaviour.

The tests cover areas including:

* Pickup clustering
* Batch triggers
* Route optimization
* Vehicle capacity
* Service radius
* Matching rules
* Authentication
* Role authorization
* Resource ownership
* Handover validation
* Organization verification
* Rematching after approval

The application has also been exercised through headless Chromium using synthetic camera input and injected coordinates across the supported roles.

---

# 🚀 Getting Started

## Prerequisites

Make sure you have:

* Node.js
* npm

installed on your system.

## Installation

```bash
npm install
```

## Development

Run the API and frontend together:

```bash
npm run dev
```

Default development endpoints:

```text
API  → http://localhost:8787
Web  → http://localhost:5173
```

Open:

```text
http://localhost:5173
```

for the landing page.

The application interface is available at:

```text
http://localhost:5173/app.html
```

On first startup, the server creates and seeds:

```text
data/ecoconnect.db
```

and runs the matcher so the demo starts with usable sample data.

---

# 🔑 Demo Accounts

| Email              | Password   | Role              |
| ------------------ | ---------- | ----------------- |
| `donor@demo.in`    | `demo1234` | Donor             |
| `industry@demo.in` | `demo1234` | NGO / Industry    |
| `driver@demo.in`   | `demo1234` | Delivery Agent    |
| `admin@demo.in`    | `demo1234` | Verification Desk |

> ⚠️ **Demo credentials are for local development/demo use only. Never use them in production.**

---

# ⚙️ Available Commands

### Install dependencies

```bash
npm install
```

### Start development environment

```bash
npm run dev
```

### Check environment and integrations

```bash
npm run check
```

### Run tests

```bash
npm test
```

### Build frontend

```bash
npm run build
```

### Start production server

```bash
npm start
```

---

# 🧠 Bring Your Own AI

AI credentials are stored only on the server.

Create a `.env` file from the provided example:

```bash
cp .env.example .env
```

## Option A — Gemini

```env
GEMINI_API_KEY=your_key
GEMINI_MODEL=your_model
```

## Option B — OpenAI-Compatible API

```env
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=your_model
```

When both providers are configured, explicitly select one:

```env
VISION_PROVIDER=gemini
```

or:

```env
VISION_PROVIDER=openai
```

OpenAI-compatible endpoints can also be used with compatible gateways or local model servers.

## Test AI Connection

```bash
npm run check
```

Test with a specific image:

```bash
npm run check -- photo.jpg
```

Inspect models available through the configured provider:

```bash
npm run check -- --models
```

---

# 🌐 Configuration

All configuration is optional for the demo.

| Variable             | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `GEMINI_API_KEY`     | Enables Gemini-based classification       |
| `GEMINI_MODEL`       | Gemini vision model                       |
| `OPENAI_API_KEY`     | Enables OpenAI-compatible classification  |
| `OPENAI_BASE_URL`    | OpenAI-compatible API endpoint            |
| `OPENAI_MODEL`       | Vision model name                         |
| `VISION_PROVIDER`    | Selects `gemini` or `openai`              |
| `JWT_SECRET`         | JWT signing secret for production         |
| `GEOCODE_USER_AGENT` | Contact identifier for geocoding requests |
| `BATCH_CRON`         | Pickup batching schedule                  |
| `VITE_TILE_URL`      | Map tile provider template                |
| `VITE_API_URL`       | API origin when hosted separately         |

---

# 📦 Deployment

Build and start the production application:

```bash
npm run build
npm start
```

For deployment:

1. Provide a persistent volume for `data/`.
2. Configure a strong `JWT_SECRET`.
3. Configure the required AI provider credentials.
4. Use HTTPS.
5. Configure an appropriate production geocoding service.
6. Replace local SQLite with PostgreSQL when the workload requires it.
7. Move uploaded images to object storage with signed URLs.

Camera and browser geolocation require a secure context, so production deployments should use HTTPS.

---

# 📁 Project Structure

```text
EcoConnect/
│
├── server/
│   ├── index.js
│   │   └── API routes, authentication wiring, cron, static build
│   │
│   ├── db.js
│   │   └── Database schema, seed data, read helpers
│   │
│   ├── auth.js
│   │   └── JWT, password hashing, roles, ownership guards
│   │
│   ├── ops.js
│   │   └── Matching, batching, delivery operations, point minting
│   │
│   ├── vision.js
│   │   └── Server-side vision model integration and validation
│   │
│   └── geo.js
│       └── Reverse geocoding, caching and rate limiting
│
├── src/
│   ├── lib/
│   │   ├── batching.js
│   │   │   └── Shared pickup batching engine
│   │   │
│   │   └── db.js
│   │       └── Frontend API client
│   │
│   ├── hooks/
│   │   └── useGeolocation.js
│   │       └── Browser GPS integration
│   │
│   ├── components/
│   │   ├── Camera.jsx
│   │   ├── MapPlot.jsx
│   │   └── LocationPicker.jsx
│   │
│   └── pages/
│       ├── Auth
│       ├── User
│       ├── Industry
│       ├── Delivery
│       ├── Admin
│       └── Shared
│
├── scripts/
│   └── check.js
│       └── Environment and integration checks
│
├── tests/
│   ├── batching.test.js
│   └── api.test.js
│
├── data/
│   ├── ecoconnect.db
│   └── uploads/
│
├── .env.example
├── package.json
└── README.md
```

### Shared Batching Engine

A deliberate architectural choice is that:

```text
src/lib/batching.js
       │
       ├──► Production Server
       │
       └──► Automated Tests
```

The same core batching logic used in production is therefore directly covered by the unit tests.

---

# 📊 Current Demo Scope

EcoConnect currently demonstrates:

* 🤖 Multimodal image-based waste identification
* 🔍 Condition assessment
* ♻️ Recovery pathway recommendation
* 📷 Real device camera access
* 📍 Real device GPS
* 🗺️ Reverse geocoding
* 🗺️ Interactive maps
* 🏢 Verified organization matching
* 📦 Pickup management
* 🚚 Pickup batching
* 🛣️ Delivery-agent assignment
* 📍 Route optimization
* 🔐 Handover verification
* 👥 Role-based access control
* ⭐ Eco-point rewards
* 📈 Impact-oriented workflow
* 🧪 Automated API and algorithm testing

---

# 🛣️ Future Roadmap

EcoConnect is designed to grow from a software platform into physical circular-economy infrastructure.

## Phase 1 — AI & Matching

```text
Identification
     ↓
Condition Assessment
     ↓
Recovery Recommendation
     ↓
Organization Matching
```

## Phase 2 — Waste Valuation

Build a dedicated valuation engine that can estimate:

* Reuse/resale value
* Refurbishment value
* Parts value
* Material recovery value
* Pickup and processing cost
* Expected net recovery value

This allows the platform to prioritize recovery routes that are both **environmentally useful and economically viable**.

## Phase 3 — Smart Collection Hardware

Deploy EcoConnect Smart Collection Points using technologies such as:

```text
Camera
  +
Weight Sensor
  +
QR / RFID
  +
IoT Connectivity
```

Potential deployment locations include:

* Apartments
* Colleges
* Offices
* Commercial buildings
* Institutional campuses

## Phase 4 — Intelligent Recovery Network

Connect:

```text
Consumers
    ↓
Smart Collection Points
    ↓
Collection Partners
    ↓
Refurbishers
    ↓
Recyclers
    ↓
Manufacturers
```

The long-term objective is a connected recovery network in which discarded products become traceable secondary resources.

---

# 💼 Startup & Business Potential

EcoConnect can operate as a multi-sided platform connecting waste generators and recovery organizations.

Potential revenue streams include:

### 1. Recovery Margin

Revenue generated from recovered materials and products.

### 2. Refurbishment & Resale Commission

Commission from devices and products routed into refurbishment and resale.

### 3. B2B Waste-Management Contracts

Managed collection and recovery services for organizations.

### 4. Smart-Kiosk Deployment

Installation, maintenance, and operation of smart collection infrastructure.

### 5. Sustainability Intelligence

Verified waste-diversion, recovery, and impact reporting for organizations.

## Scale Strategy

The initial strategy is intentionally asset-light:

```text
Software
   ↓
Validate Demand
   ↓
Build Partner Network
   ↓
Collect Operational Data
   ↓
Deploy Hardware Where Volume Justifies It
   ↓
Build City-Scale Recovery Network
```

The long-term vision is to become the **digital infrastructure layer for waste-to-value movement**.

---

# ⚠️ Known Limitations

The current implementation is a prototype/demo and has several areas that should be strengthened before production deployment.

### Image Storage

Uploaded photos are currently stored on disk.

A production deployment should use secure object storage and signed URLs.

### Handover

The current handover mechanism uses a typed code. QR generation and scanning can be added on top of the existing server-side validation.

### Driver Tracking

Live driver GPS tracking is not currently implemented. Runs transition through their workflow states manually.

### Geocoding

The current implementation uses a cached and rate-limited Nominatim integration. A production system should use an appropriate commercial or self-hosted geocoding service.

### Database

SQLite is suitable for the prototype and smaller deployments. PostgreSQL is the intended next step as concurrent traffic and operational scale increase.

---

# 🔒 Production Checklist

Before production deployment:

* [ ] Replace demo credentials
* [ ] Set a strong `JWT_SECRET`
* [ ] Keep all AI keys server-side
* [ ] Enable HTTPS
* [ ] Move uploaded images to secure object storage
* [ ] Add QR-based handover scanning
* [ ] Add live delivery-agent tracking
* [ ] Replace development geocoding infrastructure
* [ ] Migrate from SQLite to PostgreSQL at scale
* [ ] Add monitoring and structured logging
* [ ] Add rate limiting and abuse protection
* [ ] Add stronger organization/KYC verification
* [ ] Add backups and disaster recovery
* [ ] Review privacy and data-retention policies

---

# 🤝 Contributing

Contributions are welcome.

A typical workflow:

```bash
git checkout -b feature/your-feature
npm install
npm test
npm run build
```

Then open a pull request describing:

* What changed
* Why it was needed
* How it was tested
* Any configuration changes required

---

# 📜 Project

**EcoConnect AI**
**Team Celestial Voyager**
**St. Peter's Engineering College**
**SPEC'THON 2026**

> ### ♻️ From Waste Management to Intelligent Resource Recovery.
>
> **EcoConnect AI — Don't just dispose. Discover the value.**
