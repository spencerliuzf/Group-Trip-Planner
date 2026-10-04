// Shared trip data, stored in Netlify Blobs. One blob per record:
//   trip            -> trip details + crew
//   items/<id>      -> one cost
//   options/<id>    -> one trip option people vote on (one vote per person)
//   items/<id>      -> costs carry an optionId
//   days/<id>       -> one itinerary entry
// Optional privacy: set the TRIP_CODE environment variable in Netlify and
// every request must send the same value in the x-trip-code header.
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const clip = (v, n = 300) => String(v ?? "").slice(0, n);
const CATS = ["flight", "stay", "transport", "food", "activity", "other"];
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function cleanItem(b, base = {}) {
  const out = { ...base };
  if ("title" in b) out.title = clip(b.title, 200);
  if ("category" in b) out.category = CATS.includes(b.category) ? b.category : "other";
  if ("amount" in b) out.amount = Math.max(0, Number(b.amount) || 0);
  if ("basis" in b) out.basis = b.basis === "person" ? "person" : "group";
  if ("status" in b) out.status = b.status === "booked" ? "booked" : "idea";
  if ("paidBy" in b) out.paidBy = clip(b.paidBy, 60);
  if ("optionId" in b) out.optionId = clip(b.optionId, 40);
  if ("url" in b) out.url = /^https?:\/\//i.test(b.url || "") ? clip(b.url, 1000) : "";
  return out;
}

function cleanTrip(b) {
  return {
    name: clip(b.name, 120),
    destination: clip(b.destination, 120),
    start: clip(b.start, 10),
    end: clip(b.end, 10),
    currency: /^[A-Z]{3}$/.test(b.currency || "") ? b.currency : "CAD",
    budgetPP: Math.max(0, Number(b.budgetPP) || 0),
    chosen: clip(b.chosen, 40),
    crew: Array.isArray(b.crew) ? [...new Set(b.crew.map(c => clip(c, 60).trim()).filter(Boolean))].slice(0, 40) : [],
  };
}

// Read-modify-write with an ETag check, so two friends editing at once do not overwrite each other.
async function mutate(store, key, fn) {
  for (let i = 0; i < 5; i++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    if (!cur) return null;
    const next = fn(cur.data);
    const r = await store.setJSON(key, next, { onlyIfMatch: cur.etag });
    if (r.modified) return next;
  }
  throw new Error("busy");
}

async function readAll(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
  return rows.filter(Boolean);
}

export default async (req) => {
  const code = process.env.TRIP_CODE || "";
  if (code && req.headers.get("x-trip-code") !== code) return json({ error: "code required" }, 401);

  const store = getStore({ name: "trip", consistency: "strong" });
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [res, id, sub] = parts;
  const m = req.method;
  const body = ["POST", "PUT", "PATCH"].includes(m) ? await req.json().catch(() => ({})) : {};

  try {
    if (res === "state" && m === "GET") {
      const [trip, options, items, days] = await Promise.all([
        store.get("trip", { type: "json" }), readAll(store, "options/"), readAll(store, "items/"), readAll(store, "days/"),
      ]);
      return json({ trip: trip || null, options, items, days });
    }

    if (res === "trip" && m === "PUT") {
      const t = cleanTrip(body);
      await store.setJSON("trip", t);
      return json(t);
    }

    if (res === "options") {
      if (!id && m === "POST") {
        const o = { id: newId(), name: clip(body.name, 120), destination: clip(body.destination, 120),
          start: clip(body.start, 10), end: clip(body.end, 10), notes: clip(body.notes, 600), votes: [], created: Date.now() };
        if (!o.name || !o.destination) return json({ error: "name and destination required" }, 400);
        await store.setJSON("options/" + o.id, o);
        return json(o, 201);
      }
      // One vote per person: voting for one option removes that name from every other option.
      if (id && sub === "vote" && m === "POST") {
        const name = clip(body.name, 60).trim();
        if (!name) return json({ error: "name required" }, 400);
        const target = await store.get("options/" + id, { type: "json" });
        if (!target) return json({ error: "not found" }, 404);
        const removing = (target.votes || []).includes(name);
        const { blobs } = await store.list({ prefix: "options/" });
        for (const b of blobs) {
          await mutate(store, b.key, cur => {
            const v = new Set(cur.votes || []);
            if (cur.id === id && !removing) v.add(name); else v.delete(name);
            return { ...cur, votes: [...v] };
          });
        }
        return json({ ok: true });
      }
      if (id && !sub && m === "DELETE") {
        const its = await readAll(store, "items/");
        await Promise.all(its.filter(i => i.optionId === id).map(i => store.delete("items/" + i.id)));
        await store.delete("options/" + id);
        const trip = await store.get("trip", { type: "json" });
        if (trip && trip.chosen === id) await store.setJSON("trip", { ...trip, chosen: "" });
        return new Response(null, { status: 204 });
      }
    }

    if (res === "items") {
      if (!id && m === "POST") {
        const it = cleanItem(body, { id: newId(), optionId: "", title: "", category: "other", amount: 0, basis: "group", status: "idea", paidBy: "", url: "", votes: [], created: Date.now() });
        if (!it.title) return json({ error: "title required" }, 400);
        await store.setJSON("items/" + it.id, it);
        return json(it, 201);
      }
      if (id && sub === "vote" && m === "POST") {
        const name = clip(body.name, 60);
        const it = await mutate(store, "items/" + id, cur => {
          const v = new Set(cur.votes || []);
          v.has(name) ? v.delete(name) : v.add(name);
          return { ...cur, votes: [...v] };
        });
        return it ? json(it) : json({ error: "not found" }, 404);
      }
      if (id && !sub && m === "PATCH") {
        const it = await mutate(store, "items/" + id, cur => cleanItem(body, cur));
        return it ? json(it) : json({ error: "not found" }, 404);
      }
      if (id && !sub && m === "DELETE") {
        await store.delete("items/" + id);
        return new Response(null, { status: 204 });
      }
    }

    if (res === "days") {
      if (!id && m === "POST") {
        const d = { id: newId(), date: clip(body.date, 10), time: clip(body.time, 5), text: clip(body.text, 300) };
        if (!d.date || !d.text) return json({ error: "date and text required" }, 400);
        await store.setJSON("days/" + d.id, d);
        return json(d, 201);
      }
      if (id && m === "DELETE") {
        await store.delete("days/" + id);
        return new Response(null, { status: 204 });
      }
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: "server error" }, 500);
  }
};
