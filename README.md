# A-Z Jewelry & Swap Shop — digital store

Storefront, A-Z Auction Block and Owner Command Center for A-Z Jewelry & Swap
Shop, Peoria, Illinois. Built and run by GALOR under the A–Z Pawn customer project.

- `index.html`, `app.js`, `styles.css` — the public store.
- `owner.html`, `owner.js`, `owner.css` — the staff Command Center (sign-in required).
- `server/` — the store's own backend: Python, FastAPI and one SQLite file. No subscriptions.
- `deploy/` — service, web server and backup files for the store's server.

**Two modes.** When the backend is running, everything is live. When the pages are
opened without it (the GitHub Pages preview), they fall back to the
presentation data and show a demo banner; nothing is sent anywhere.

## What runs live

- **Store:** inventory from the database; items held for a set period stay hidden
  until their date; the cart reserves items for pickup or shipping and the shop calls
  to take payment (no online payment yet).
- **Auction Block:** bidder accounts approved by staff; every bid checked on the
  server; the minimum next bid rises with the price; a bid in the last two minutes
  extends the close by two minutes (no sniping); optional hidden reserve; the winner's
  contact details go to staff, and the item is held for them.
- **Sell / pawn / video requests:** sent with photos straight to the Command Center.
  Photos are resized and re-encoded, which strips GPS location data.
- **Command Center:** add items from a phone photo, publish, price, mark sold, hide;
  start, watch and cancel auctions; approve or block bidders; work orders and
  inquiries; prepare Google Meet messages.

## Run it locally

```sh
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
cd server
../.venv/bin/python -m azpawn.manage seed-demo            # optional sample inventory
../.venv/bin/python -m azpawn.manage add-staff owner      # asks for a password (12+ chars)
AZ_SECURE_COOKIES=0 ../.venv/bin/python -m azpawn.manage serve --port 8080
```

Open http://localhost:8080 (store) and http://localhost:8080/owner.html (Command Center).
Tests: `cd server && ../.venv/bin/pip install pytest httpx && ../.venv/bin/python -m pytest`.

## Put it on the store's server

Needs root on the server, once:

1. `sudo useradd --system --home /var/lib/azpawn azpawn && sudo mkdir -p /var/lib/azpawn && sudo chown azpawn:azpawn /var/lib/azpawn && sudo chmod 700 /var/lib/azpawn` (holds password hashes, customer data and photos — never world-readable)
2. `sudo git clone https://github.com/islamismylifebey-web/az-pawn-peoria-demo /opt/azpawn`
   then `sudo python3 -m venv /opt/azpawn/.venv && sudo /opt/azpawn/.venv/bin/pip install -r /opt/azpawn/server/requirements.txt`
3. Staff login: `cd /opt/azpawn/server && sudo -u azpawn AZ_DATA_DIR=/var/lib/azpawn /opt/azpawn/.venv/bin/python -m azpawn.manage add-staff owner`
4. Service: `sudo cp /opt/azpawn/deploy/azpawn.service /etc/systemd/system/ && sudo systemctl enable --now azpawn`
5. HTTPS: install Caddy and add `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`.
6. DNS: point `azpawn.galorweb.works` at the server's IP (an A record), and remove the
   custom domain from this repository's GitHub Pages settings so the two don't compete.
7. Backups: install `sqlite3`, provision the backup directory first (`sudo mkdir -p /var/backups/azpawn && sudo chown azpawn:azpawn /var/backups/azpawn && sudo chmod 700 /var/backups/azpawn` — the service account cannot create it itself), then add `deploy/backup.sh` to the azpawn user's crontab.

## Before the public launch

- Confirm with the owner the Illinois holding period for purchased and pawned goods
  and enter it as each item's "not for sale before" date.
- Confirm the auction terms (buyer's premium, payment deadline, pickup) and whether any
  auction rules or licensing apply to the shop; firearms and other restricted categories
  should not be listed online.
- Replace the stock photos and sample copy with the shop's own.
