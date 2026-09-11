export const WASTE_TYPES = [
  { id: 'textile', label: 'Textile', note: 'Clothing, fabric, footwear' },
  { id: 'paper', label: 'Paper & card', note: 'Cartons, books, packaging' },
  { id: 'e-waste', label: 'E-waste', note: 'Devices, cables, batteries' },
  { id: 'plastic', label: 'Plastic', note: 'Bottles, containers, film' },
  { id: 'metal', label: 'Metal', note: 'Cans, scrap, fittings' },
  { id: 'glass', label: 'Glass', note: 'Bottles, jars, panes' },
  { id: 'furniture', label: 'Furniture', note: 'Wood, upholstery, fittings' },
  { id: 'organic', label: 'Organic', note: 'Garden, food, compostable' },
]

export const wasteLabel = (id) =>
  WASTE_TYPES.find((w) => w.id === id)?.label ?? id

export const PICKUP_STATUS = {
  requested: { label: 'Requested', tone: 'mute' },
  matched: { label: 'Matched', tone: 'info' },
  batched: { label: 'In a run', tone: 'warn' },
  picked: { label: 'Collected', tone: 'warn' },
  delivered: { label: 'Delivered', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
}

export const RUN_STATUS = {
  proposed: { label: 'Offered', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'info' },
  in_progress: { label: 'Collecting', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
}

export const TRIGGER_LABEL = {
  bulk_weight: 'Bulk weight reached',
  stop_count: 'Enough stops nearby',
  max_wait: 'Oldest pickup hit the wait limit',
}
