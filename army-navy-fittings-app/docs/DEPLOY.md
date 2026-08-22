# Putting it online

Every push to `main` that touches this folder builds the app and publishes it to GitHub Pages via
`.github/workflows/deploy-shop-app.yml`. The workflow runs the tests first and will not deploy a build that
fails them.

## One-time setup

**Pages has to be switched on by hand, once.** In the repo: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. Then re-run the deploy: **Actions → Deploy shop app → Run workflow**.

This step cannot be automated. The Actions `GITHUB_TOKEN` is not permitted to create a Pages site — the
`configure-pages` action offers an `enablement: true` option for it, but the call comes back
`Resource not accessible by integration` no matter what permissions the workflow declares. Creating a Pages
site needs repo-admin rights that the workflow token does not get. Every deploy after that first switch is
automatic.

Once it is on, the live URL is on the **Actions → Deploy shop app** run summary and under **Settings →
Pages**. For this repo it is `https://drikus1985.github.io/impulse-buy-engine/`.

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

`drikus1985.github.io/impulse-buy-engine/` works, but it is not a URL to print on a business card.
`shop.anfittings.co.za` is the natural home and is currently unused.

**Use a subdomain, not the apex.** As of August 2026 the zone looks like this:

| Record | Value | What it is |
| --- | --- | --- |
| nameservers | `ns1.enter-system.com`, `ns2.enter-system.com` | DNS is managed at Enter System |
| `anfittings.co.za` | A → `166.117.120.15` | the main site |
| `www` | CNAME → `ssl.site123.com` | the main site is built on SITE123 |
| `shop` | — | free |

Pointing the apex or `www` at GitHub would take the main website down.

### Order matters

Do the DNS first. Setting the custom domain in GitHub before the name resolves takes the **current** site
offline — GitHub stops serving `drikus1985.github.io/impulse-buy-engine/` and starts answering for a hostname
that does not exist yet.

1. **At Enter System**, in the DNS zone for `anfittings.co.za`, add:

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | `CNAME` | `shop` | `drikus1985.github.io.` | default |

   The target is the **user** domain, not the project path — no `/impulse-buy-engine` and no `https://`.
   Some panels want a trailing dot, some add it themselves.

2. **Wait for it to resolve.** `nslookup shop.anfittings.co.za` should answer before you go on; a new record
   is usually minutes, occasionally an hour.

3. **In the repo**, Settings → Pages → Custom domain, enter `shop.anfittings.co.za`, save. GitHub re-checks
   DNS and issues a certificate.

4. **Tick Enforce HTTPS** once it stops being greyed out — the certificate takes a few more minutes. The PWA
   will not install or work offline without it.

No code change and no `CNAME` file in the repo: for a site published by Actions, the Settings field is what
GitHub reads. Asset paths are relative, so the app works at a domain root and in a sub-folder alike.

### What moves and what doesn't

A browser treats `shop.anfittings.co.za` as a different origin from `drikus1985.github.io`, so anyone who has
already installed the app or built a parts list on the old URL keeps that install and that list where it is —
neither follows to the new domain. Nothing is lost, but it is a reason to move sooner rather than later, while
almost nobody has installed it. The old URL redirects to the new one once the custom domain is live.

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
