# Pledge price feed for the A-Z store

Built by **GALOR WebWorks** for A-Z Jewelry & Swap Inc. Licensed for A-Z's use only.

Pledge sends its dynamic prices (market price adjusted for demand and season) to the
store. Every item on azpawn.galorweb.works then shows that price, unless Gary has
locked his own price on it.

## Which price the store shows

1. **Locked** (Gary's own price) always wins. Typing a price in the Command Center locks it.
   The **Lock price / Unlock price** button turns the lock on or off without changing the price.
2. **Dynamic** (Pledge's price), when Pledge has sent one in the last 14 days.
3. **Set** price from the Command Center, or "Ask for price" when it is 0.

Online orders are charged the price shown.

## Sending prices

`POST https://azpawn.galorweb.works/api/pledge/feed`

Headers, signed exactly like Pledge's market feed (`marketwatch.feed_push`):

- `Content-Type: application/json`
- `X-Pledge-Timestamp`: Unix seconds. Refused if more than 5 minutes off.
- `X-Pledge-Signature`: `sha256=` + hex HMAC-SHA256 of `timestamp + "." + body`, keyed with the store feed secret.

The secret is its own key, not the market feed's. It sits in the Worker as `PLEDGE_FEED_SECRET`
and in `worker\.pledge-feed-secret` on GALOR-CORE (never in git, chat or notes).

Body (items only: no customer, ticket or loan data is accepted or stored):

```json
{
  "v": 1,
  "at": "2026-11-24T18:00:00+00:00",
  "items": [
    { "sku": "AZ-GAM-1012", "dynamic_cents": 1800, "why": "demand up, holiday season" },
    { "pledge_item": "202603801", "dynamic_cents": 4500 },
    { "sku": "AZ-ELC-1040", "dynamic_cents": null }
  ]
}
```

- `sku`: the store's item SKU (from `GET /api/items`). Or `pledge_item`: a Pledge item number
  linked to a store item in the Command Center. One of the two is needed.
- `dynamic_cents`: whole cents, 0 to 10,000,000. `null` clears the dynamic price.
- `why`: optional, up to 200 characters, shown to staff only.
- At most 2000 items and 1 MB per push. Any other fields (for example `shop`, `kinds`, `metals`) are ignored.
- The same body sent twice is ignored (`"duplicate": true`).

Answer: `{"ok": true, "received": 5, "matched": 3, "rejected": [3, 4]}` where `rejected` lists
the positions of items with a bad SKU or price.

To price the store's items, Pledge can read the public list `GET https://azpawn.galorweb.works/api/items`
(sku, name, category, condition, current price) and send back a price for each sku.

Staff can see recent pushes at `GET /api/staff/feed` (signed in).

## Setup (done once)

```sh
npx wrangler d1 execute az-jewelry-store --remote --file migrations/0002_dynamic_price.sql
npx wrangler secret put PLEDGE_FEED_SECRET   # value generated on GALOR-CORE, kept in .pledge-feed-secret
npx wrangler deploy
```

Test locally: put `PLEDGE_FEED_SECRET=...` in `.dev.vars`, run `npx wrangler dev --local`,
then `node test/feed.mjs` (needs the local `smoketest` staff login).
