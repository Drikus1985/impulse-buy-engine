# Putting it online

`npm run build` produces `dist/` — static HTML, CSS, JavaScript and icons. There is no server, no database and
no API key, so anything that serves files will host it.

```bash
npm ci
npm run icons
npm run import      # needs data/source/anf-pricelist.csv
npm run build
```

Upload the **contents** of `dist/`.

Asset paths are relative, so the app works both at a domain root and in a sub-folder
(`anfittings.co.za/app/`). Routing is hash-based (`#/reference`), which means no server rewrite rules are
needed either.

## Options

**Netlify or Cloudflare Pages** — drag `dist/` onto the dashboard, or point it at the repo with build command
`npm run build` and publish directory `dist`. Both give HTTPS on a subdomain immediately, and a custom domain
in a few clicks. Free for this size of site.

**Existing hosting.** If anfittings.co.za already has cPanel or FTP, upload `dist/` into a folder such as
`/public_html/app/`. Nothing else on the site is touched.

**GitHub Pages.** Push `dist/` to a `gh-pages` branch. Works because paths are relative.

## HTTPS is required

Service workers and installability need HTTPS (or `localhost`). Without it the app still works, but it will
not install and will not run offline.

## After it is up

Check on a phone:

1. Open the site in Chrome or Safari.
2. Chrome offers **Install app**; on iOS use Share → **Add to Home Screen**.
3. Open it from the home-screen icon, then turn on flight mode. The catalogue and the AN size chart should
   still come up.

## Pointing customers at it

The shop already has a site. The app suits a prominent link on it — "Search the full catalogue" — rather than
a replacement, since the app has no blog, no about page and no images.

The WhatsApp handoff uses `wa.me/27105921706`, from `SHOP` in `src/lib/shop.ts`. Change the number there if
enquiries should land somewhere else, and rebuild.

## Redeploying after a price change

```bash
npm run import && npm run build
```

Then upload `dist/` again. Returning visitors pick up the new catalogue on their next visit: the service
worker serves the cached copy first and fetches the update behind it, so the change shows on the visit after.
A customer who wants it immediately can pull to refresh.

If a price change must land the same day, bump `CACHE_VERSION` in `public/sw.js` before building — that
retires the old cache outright.

## Taking payment later

The app deliberately ends at an enquiry: this shop quotes freight per order and confirms stock by hand, so a
card payment taken up front would be a promise it cannot yet keep. When that changes, the cart already has
what a gateway needs — line items, quantities, and a VAT-inclusive total in cents. PayFast and Yoco are the
usual South African choices, and both need a server endpoint to sign the request, which is the piece this
project does not currently have.
