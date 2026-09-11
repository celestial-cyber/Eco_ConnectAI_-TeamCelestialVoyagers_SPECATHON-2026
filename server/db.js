/* ============================================================
   SQLite schema + seed.
   One file on disk (data/ecoconnect.db). No external service to
   sign up for — `npm run dev` gives you a real database.
   ============================================================ */

import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE = process.env.DB_FILE || resolve('data/ecoconnect.db')
mkdirSync(dirname(FILE), { recursive: true })

export const db = new Database(FILE)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export const uid = () => randomUUID()
const now = () => new Date().toISOString()
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString()

db.exec(`
create table if not exists profiles (
  id          text primary key,
  email       text not null unique collate nocase,
  password    text not null,
  role        text not null check (role in ('user','industry','delivery','admin')),
  full_name   text not null,
  phone       text,
  eco_points  integer not null default 0,
  created_at  text not null
);

create table if not exists industries (
  id                  text primary key,
  owner_id            text not null references profiles(id) on delete cascade,
  name                text not null,
  org_type            text not null default 'ngo',
  reg_number          text not null unique,
  gst_number          text,
  contact_person      text,
  phone               text,
  contact_email       text,
  address             text not null,
  city                text,
  pincode             text,
  lat                 real not null,
  lng                 real not null,
  capacity_kg_month   real,
  doc_ref             text,
  verification_status text not null default 'pending'
                      check (verification_status in ('pending','verified','rejected')),
  verification_note   text,
  verified_at         text,
  created_at          text not null
);
create index if not exists idx_ind_owner on industries(owner_id);

create table if not exists industry_waste_types (
  industry_id text not null references industries(id) on delete cascade,
  waste_type  text not null,
  primary key (industry_id, waste_type)
);

create table if not exists industry_areas (
  id          text primary key,
  industry_id text not null references industries(id) on delete cascade,
  area_name   text not null,
  lat         real not null,
  lng         real not null,
  radius_km   real not null default 5,
  created_at  text not null
);
create index if not exists idx_area_ind on industry_areas(industry_id);

create table if not exists delivery_agents (
  id                text primary key,
  profile_id        text not null unique references profiles(id) on delete cascade,
  agent_code        text not null unique,
  service_area_name text not null,
  lat               real not null,
  lng               real not null,
  radius_km         real not null default 10,
  phone             text,
  licence_no        text,
  status            text not null default 'offline'
                    check (status in ('offline','available','on_run')),
  created_at        text not null
);

create table if not exists vehicles (
  id               text primary key,
  agent_id         text not null unique references delivery_agents(id) on delete cascade,
  vehicle_type     text not null default 'van' check (vehicle_type = 'van'),
  make_model       text not null,
  reg_plate        text not null unique,
  capacity_kg      real not null check (capacity_kg > 0),
  insurance_expiry text
);

create table if not exists pickups (
  id             text primary key,
  user_id        text not null references profiles(id) on delete cascade,
  photo_path     text,
  item_label     text not null,
  waste_type     text not null,
  condition      real,
  pathway        text,
  confidence     real,
  est_weight_kg  real not null default 5 check (est_weight_kg > 0),
  address        text not null,
  lat            real not null,
  lng            real not null,
  accuracy_m     real,
  status         text not null default 'requested'
                 check (status in ('requested','matched','batched','picked','delivered','cancelled')),
  industry_id    text references industries(id) on delete set null,
  run_id         text,
  points_awarded integer not null default 0,
  created_at     text not null,
  delivered_at   text
);
create index if not exists idx_pick_user on pickups(user_id);
create index if not exists idx_pick_ind  on pickups(industry_id, status);
create index if not exists idx_pick_stat on pickups(status);

create table if not exists runs (
  id               text primary key,
  agent_id         text not null references delivery_agents(id) on delete cascade,
  industry_id      text not null references industries(id) on delete cascade,
  status           text not null default 'proposed'
                   check (status in ('proposed','accepted','in_progress','delivered','cancelled')),
  trigger_reason   text,
  weight_kg        real not null default 0,
  distance_km      real not null default 0,
  solo_distance_km real not null default 0,
  saved_pct        integer not null default 0,
  qr_token         text not null,
  created_at       text not null,
  accepted_at      text,
  delivered_at     text
);
create index if not exists idx_run_agent on runs(agent_id, status);
create index if not exists idx_run_ind   on runs(industry_id, status);

create table if not exists run_stops (
  run_id    text not null references runs(id) on delete cascade,
  pickup_id text not null references pickups(id) on delete cascade,
  seq       integer not null,
  picked_at text,
  primary key (run_id, pickup_id)
);

create table if not exists notifications (
  id         text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  ref_id     text,
  read       integer not null default 0,
  created_at text not null
);
create index if not exists idx_notif on notifications(profile_id, read);

create table if not exists hub_events (
  id         text primary key,
  run_id     text references runs(id) on delete cascade,
  kind       text not null,
  payload    text not null default '{}',
  created_at text not null
);
create index if not exists idx_hub on hub_events(created_at desc);

-- reverse-geocode cache, so we stay well inside Nominatim's usage policy
create table if not exists geocache (
  key        text primary key,
  address    text not null,
  raw        text,
  created_at text not null
);
`)

/* ---------------- seed ---------------- */
export function seedIfEmpty() {
  const count = db.prepare('select count(*) c from profiles').get().c
  if (count > 0) return false

  const pw = bcrypt.hashSync('demo1234', 10)
  const mkUser = db.prepare(`insert into profiles
    (id,email,password,role,full_name,phone,eco_points,created_at)
    values (@id,@email,@password,@role,@full_name,@phone,@eco_points,@created_at)`)

  const users = [
    { id: 'u-donor', email: 'donor@demo.in', role: 'user', full_name: 'Ananya Rao',
      phone: '+91 90000 10001', eco_points: 480 },
    { id: 'u-donor2', email: 'ravi@demo.in', role: 'user', full_name: 'Ravi Teja',
      phone: '+91 90000 10004', eco_points: 120 },
    { id: 'u-ind', email: 'industry@demo.in', role: 'industry', full_name: 'Goonj Collection Hub',
      phone: '+91 90000 10002', eco_points: 0 },
    { id: 'u-ind2', email: 'eparis@demo.in', role: 'industry', full_name: 'E-Parisaraa Recyclers',
      phone: '+91 90000 10005', eco_points: 0 },
    { id: 'u-agent', email: 'driver@demo.in', role: 'delivery', full_name: 'Imran Q.',
      phone: '+91 90000 10003', eco_points: 0 },
    { id: 'u-agent2', email: 'sunita@demo.in', role: 'delivery', full_name: 'Sunita M.',
      phone: '+91 90000 10006', eco_points: 0 },
    { id: 'u-admin', email: 'admin@demo.in', role: 'admin', full_name: 'Verification Desk',
      phone: '', eco_points: 0 },
  ]
  for (const u of users) mkUser.run({ ...u, password: pw, created_at: hoursAgo(800) })

  const mkInd = db.prepare(`insert into industries
    (id,owner_id,name,org_type,reg_number,contact_person,contact_email,phone,address,city,pincode,
     lat,lng,capacity_kg_month,verification_status,verified_at,created_at)
    values (@id,@owner_id,@name,@org_type,@reg_number,@contact_person,@contact_email,@phone,
     @address,@city,@pincode,@lat,@lng,@capacity_kg_month,@verification_status,@verified_at,@created_at)`)
  const mkWaste = db.prepare('insert into industry_waste_types values (?,?)')
  const mkArea = db.prepare(`insert into industry_areas
    (id,industry_id,area_name,lat,lng,radius_km,created_at) values (?,?,?,?,?,?,?)`)

  mkInd.run({
    id: 'ind-goonj', owner_id: 'u-ind', name: 'Goonj Collection Hub', org_type: 'ngo',
    reg_number: 'TS/NGO/2019/4471', contact_person: 'Meera S.', contact_email: 'hub@goonj.demo',
    phone: '+91 90000 10002', address: 'Plot 22, Gachibowli', city: 'Hyderabad', pincode: '500032',
    lat: 17.4401, lng: 78.3489, capacity_kg_month: 6000,
    verification_status: 'verified', verified_at: hoursAgo(700), created_at: hoursAgo(720),
  })
  for (const w of ['textile', 'paper', 'furniture']) mkWaste.run('ind-goonj', w)
  mkArea.run('ar-1', 'ind-goonj', 'Hitec City & Madhapur', 17.4485, 78.3908, 7, hoursAgo(700))
  mkArea.run('ar-2', 'ind-goonj', 'Kondapur', 17.4615, 78.362, 5, hoursAgo(700))

  mkInd.run({
    id: 'ind-eparis', owner_id: 'u-ind2', name: 'E-Parisaraa Recyclers', org_type: 'recycler',
    reg_number: 'TS/IND/2021/8830', contact_person: 'Karthik R.', contact_email: 'ops@eparisaraa.demo',
    phone: '+91 90000 10005', address: 'IDA Uppal', city: 'Hyderabad', pincode: '500039',
    lat: 17.4012, lng: 78.5583, capacity_kg_month: 20000,
    verification_status: 'verified', verified_at: hoursAgo(500), created_at: hoursAgo(520),
  })
  for (const w of ['e-waste', 'metal', 'plastic']) mkWaste.run('ind-eparis', w)
  mkArea.run('ar-3', 'ind-eparis', 'Greater Hyderabad', 17.44, 78.45, 22, hoursAgo(500))

  const mkAgent = db.prepare(`insert into delivery_agents
    (id,profile_id,agent_code,service_area_name,lat,lng,radius_km,phone,licence_no,status,created_at)
    values (@id,@profile_id,@agent_code,@service_area_name,@lat,@lng,@radius_km,@phone,@licence_no,@status,@created_at)`)
  const mkVeh = db.prepare(`insert into vehicles
    (id,agent_id,vehicle_type,make_model,reg_plate,capacity_kg,insurance_expiry)
    values (?,?,'van',?,?,?,?)`)

  mkAgent.run({
    id: 'ag-imran', profile_id: 'u-agent', agent_code: 'ECO-DA-HYD-4821',
    service_area_name: 'Hitec City / Madhapur', lat: 17.447, lng: 78.38, radius_km: 14,
    phone: '+91 90000 10003', licence_no: 'TS0120180044219', status: 'available',
    created_at: hoursAgo(300),
  })
  mkVeh.run('v-1', 'ag-imran', 'Tata Ace Gold', 'TS 09 UB 4412', 750, '2027-03-14')

  mkAgent.run({
    id: 'ag-sunita', profile_id: 'u-agent2', agent_code: 'ECO-DA-KON-6190',
    service_area_name: 'Kondapur', lat: 17.464, lng: 78.365, radius_km: 10,
    phone: '+91 90000 10006', licence_no: 'TS0920190077123', status: 'available',
    created_at: hoursAgo(260),
  })
  mkVeh.run('v-2', 'ag-sunita', 'Mahindra Supro', 'TS 07 KL 2290', 600, '2026-11-02')

  const mkPick = db.prepare(`insert into pickups
    (id,user_id,item_label,waste_type,condition,pathway,confidence,est_weight_kg,
     address,lat,lng,status,industry_id,points_awarded,created_at,delivered_at)
    values (@id,@user_id,@item_label,@waste_type,@condition,@pathway,@confidence,@est_weight_kg,
     @address,@lat,@lng,@status,@industry_id,@points_awarded,@created_at,@delivered_at)`)

  const p = (id, user, label, type, cond, kg, lat, lng, addr, age, extra = {}) => ({
    id, user_id: user, item_label: label, waste_type: type, condition: cond,
    pathway: cond >= 7 ? 'REUSABLE · DONATE' : cond >= 5 ? 'REPAIRABLE · REFURBISH' : 'RECYCLABLE',
    confidence: 90 + Math.round(cond * 0.8), est_weight_kg: kg,
    address: addr, lat, lng, status: 'requested', industry_id: null,
    points_awarded: 0, created_at: hoursAgo(age), delivered_at: null, ...extra,
  })

  const picks = [
    p('pk-1', 'u-donor', 'Denim jacket', 'textile', 8.2, 6, 17.4502, 78.3931, 'Madhapur, Road 36', 3),
    p('pk-2', 'u-donor2', 'Cotton bedsheets ×4', 'textile', 7.1, 9, 17.4468, 78.3862, 'Kavuri Hills', 2.5),
    p('pk-3', 'u-donor', 'Cardboard cartons', 'paper', 6.4, 14, 17.4531, 78.3975, 'Hitec City MMTS', 2),
    p('pk-4', 'u-donor2', 'Office paper bundle', 'paper', 5.9, 18, 17.4449, 78.3835, 'Cyber Towers', 1.5),
    p('pk-5', 'u-donor', 'Old study desk', 'furniture', 6.8, 26, 17.456, 78.389, 'Ayyappa Society', 1),
    p('pk-6', 'u-donor2', 'Wool scarves', 'textile', 8.8, 3, 17.463, 78.3601, 'Kondapur Main Rd', 0.6),
    p('pk-7', 'u-donor', 'Laptop, 14 inch', 'e-waste', 5.4, 3, 17.449, 78.392, 'Madhapur', 0.4),
    p('pk-8', 'u-donor', 'Winter coats ×3', 'textile', 8.5, 11, 17.4478, 78.3899, 'Madhapur', 60,
      { status: 'delivered', industry_id: 'ind-goonj', points_awarded: 247, delivered_at: hoursAgo(56) }),
  ]
  for (const row of picks) mkPick.run(row)

  return true
}

/* ---------------- read helpers used across routes ---------------- */

export const getIndustryFull = (id) => {
  const row = db.prepare('select * from industries where id = ?').get(id)
  return row ? hydrateIndustry(row) : null
}

export const hydrateIndustry = (row) => ({
  ...row,
  waste_types: db
    .prepare('select waste_type from industry_waste_types where industry_id = ?')
    .all(row.id)
    .map((r) => r.waste_type),
  areas: db.prepare('select * from industry_areas where industry_id = ?').all(row.id),
})

export const allIndustries = () =>
  db.prepare('select * from industries').all().map(hydrateIndustry)

export const hydrateAgent = (row) =>
  row && { ...row, vehicle: db.prepare('select * from vehicles where agent_id = ?').get(row.id) }

export const allAgents = () =>
  db.prepare('select * from delivery_agents').all().map(hydrateAgent)

export const hydrateRun = (row) => {
  if (!row) return null
  const stops = db
    .prepare(
      `select rs.seq, rs.picked_at, rs.pickup_id, p.*
         from run_stops rs join pickups p on p.id = rs.pickup_id
        where rs.run_id = ? order by rs.seq`
    )
    .all(row.id)
    .map((r) => ({
      seq: r.seq,
      picked_at: r.picked_at,
      pickup_id: r.pickup_id,
      pickup: { ...r, seq: undefined, picked_at: undefined },
    }))
  return {
    ...row,
    stops,
    industry: db.prepare('select id,name,address,lat,lng,owner_id from industries where id = ?').get(row.industry_id),
    agent: db
      .prepare('select id,agent_code,service_area_name,lat,lng,profile_id,phone from delivery_agents where id = ?')
      .get(row.agent_id),
  }
}

export const notify = (profile_id, kind, title, body, ref_id = null) =>
  db
    .prepare(
      `insert into notifications (id,profile_id,kind,title,body,ref_id,read,created_at)
       values (?,?,?,?,?,?,0,?)`
    )
    .run(uid(), profile_id, kind, title, body, ref_id, now())

export const publicUser = (u) =>
  u && { id: u.id, email: u.email, role: u.role, full_name: u.full_name, phone: u.phone,
         eco_points: u.eco_points, created_at: u.created_at }
