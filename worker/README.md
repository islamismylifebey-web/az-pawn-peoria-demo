# A-Z Jewelry & Swap store on Cloudflare

Built and run by **GALOR WebWorks** for A-Z Jewelry & Swap Inc., Peoria, Illinois.
Licensed for A-Z's use only; not for resale or modification by others.

The store, the A-Z Auction Block and the staff Command Center run as one
Cloudflare Worker, so the site no longer depends on any computer at home:

- `public/` is the website (served as static files).
- `worker/src/` is the store's server: items, hold-list orders, sell/pawn/custom
  requests, bidder accounts, bids, Stripe card holds and the Command Center API.
  It is a direct port of the original Python server in `server/`.
- **D1** database `az-jewelry-store` holds items, orders, requests, bidders and auctions.
- **R2** bucket `az-jewelry-store-media` holds photos added after launch
  (staff uploads and customer photos). Customer photos are staff-only.
- A cron trigger every 5 minutes opens and closes auctions on time.

## First deploy (once, from a computer signed in to Cloudflare)

```sh
cd worker
npm install
node tools/pull-current-store.mjs http://100.88.0.9:8080   # stylesheet, hero, inventory and item photos
npx wrangler d1 create az-jewelry-store                    # put the id it prints into wrangler.jsonc
npx wrangler r2 bucket create az-jewelry-store-media
npx wrangler d1 execute az-jewelry-store --remote --file schema.sql
node tools/build-seed.mjs ../public/inventory/inventory.json seed.sql
npx wrangler d1 execute az-jewelry-store --remote --file seed.sql
npx wrangler deploy
node tools/add-staff.mjs <username>                        # the owner types the password; only a hash is stored
```

Stripe card holds switch on when Gary's secret key is added:
`npx wrangler secret put AZ_STRIPE_SECRET_KEY` (typed by the owner, never pasted into chat).

## Updates

Edit files, then `npx wrangler deploy`. Prices and items are changed in the
Command Center (`/owner.html`), not in code.

## Tests

`npx wrangler dev --local` then `node test/smoke.mjs` (needs a local staff
login `smoketest`, made with `node tools/add-staff.mjs smoketest --local`).
