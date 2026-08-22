# Putting it online

**It is already online.** Every push to `main` that touches this folder builds the app and publishes it to
GitHub Pages via `.github/workflows/deploy-shop-app.yml`. The workflow runs the tests first and will not
deploy a build that fails them.

The live URL is on the repo's **Actions → Deploy shop app** run summary, and under **Settings → Pages**. For
this repo it is `https://drikus1985.github.io/impulse-buy-engine/`.

To publish a price change: update the catalogue (`npm run import`), commit `src/data/catalogue.json`, push to
`main`. That is the whole deploy.

To redeploy without a code change — **Actions → Deploy shop app → Run workflow**.

The rest of this page covers hosting it somewhere else, and the custom-domain step.

## Building it yourself

`npm run build` produces `dist/` — static HTML, CSS, JavaScript and icons. There is no server, no database and
no API key, so anything that serves files will host it.

```bash
npm ci
npm run build
```

`npm run import` is only needed when prices have changed — the catalogue it produces is committed, so a plain
checkout builds without the price list present. The icons are committed too.

Upload the **contents** of `dist/`.

Asset paths are relative, so the app works both at a domain root and in a sub-folder
(`anfittings.co.za/app/`). Routing is hash-based (`#/reference`), which means no server rewrite rules are
needed either.

## A custom domain

`drikus1985.github.io/impulse-buy-engine/` works, but it is not a URL to print on a business card. To serve the
app from something like `shop.anfittings.co.za`:

1. At the DNS host for `anfittings.co.za`, add a `CNAME` record: `shop` -> `drikus1985.github.io`.
2. In the repo, **Settings -> Pages -> Custom domain**, enter `shop.anfittings.co.za` and save. GitHub writes a
   `CNAME` file and issues a certificate; tick **Enforce HTTPS** once it appears.

No code change is needed. Asset paths are relative, so the app works at a domain root and in a sub-folder
alike — which is also why the sub-path URL above works today.

## Other hosts

**Netlify or Cloudflare Pages** — drag `dist/` onto the dashboard, or point it at the repo with build command
`npm run build` and publish directory `dist`. Both give HTTPS on a subdomain immediately, and a custom domain
in a few clicks. Free for this size of site.

**Existing hosting.** If anfittings.co.za already has cPanel or FTP, upload `dist/` into a folder such as
`/public_html/app/`. Nothing else on the site is touched.

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

On GitHub Pages this is just `npm run import`, commit the catalogue, push. Hosting it yourself:

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
