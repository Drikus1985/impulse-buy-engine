import { AN_SIZES } from '../lib/an-reference';
import { SHOP } from '../lib/shop';

/**
 * The size chart. This is the reason to install the app rather than bookmark
 * the site: it is the thing people need while lying under a car with no signal.
 */
export function ReferencePage() {
  return (
    <div className="page">
      <h1>AN size reference</h1>
      <p className="lede">
        The AN dash number is the tube outside diameter in sixteenths of an inch — AN8 is 8/16", or 1/2". Works offline.
      </p>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Size</th>
                <th>Thread</th>
                <th>Tube OD</th>
                <th>Hose bore</th>
                <th>Hose bore (mm)</th>
              </tr>
            </thead>
            <tbody>
              {AN_SIZES.map((s) => (
                <tr key={s.dash}>
                  <td className="dash">AN{s.dash}</td>
                  <td>{s.thread}</td>
                  <td>{s.tubeOd}</td>
                  <td>{s.hoseIdImperial}</td>
                  <td>{s.hoseIdMetric}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Published figures for the AN standard, given so you can sanity-check a fitting before you cut hose. They are
          not measurements of individual stock — if a part has to seal against something specific, confirm it with the
          shop.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Reading a part number</h2>
        <p>
          Most ANF part numbers end in the dash size: <code>ANFAN920-08</code> is AN8. Where two sizes appear —
          <code> ANFAN920-08-16</code> — the part steps from the first to the second.
        </p>
        <p>
          Hose ends carry the bend in front of the size in a four-digit block: <code>ANFX236-9010</code> is a 90° AN10,
          and <code>ANPTFE-1208-L</code> is a 120° AN8. <code>12</code>, <code>15</code> and <code>18</code> mean 120°,
          150° and 180°.
        </p>
      </div>
    </div>
  );
}

export function ContactPage() {
  return (
    <div className="page">
      <h1>{SHOP.name}</h1>
      <p className="lede">{SHOP.tagline}</p>

      <div className="panel">
        <dl className="detail-spec">
          <dt>Shop</dt>
          <dd>{SHOP.address}</dd>
          <dt>Phone</dt>
          <dd>
            <a href={`tel:+${SHOP.phoneDigits}`}>{SHOP.phone}</a>
          </dd>
          <dt>WhatsApp</dt>
          <dd>
            <a href={`https://wa.me/${SHOP.phoneDigits}`} target="_blank" rel="noreferrer">
              Message the shop
            </a>
          </dd>
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${SHOP.email}`}>{SHOP.email}</a>
          </dd>
          <dt>Hours</dt>
          <dd>{SHOP.hours}</dd>
          <dt>Website</dt>
          <dd>
            <a href={SHOP.website} target="_blank" rel="noreferrer">
              anfittings.co.za
            </a>
          </dd>
        </dl>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>How ordering works here</h2>
        <p>
          This app does not take payment. You build a parts list, then send it to the shop on WhatsApp or by email. They
          confirm what is on the shelf, quote delivery, and take it from there.
        </p>
        <p>
          Prices shown include {''}
          VAT and come from the shop's current price list. Stock labels come from a periodic count rather than a live
          feed, so treat "in stock" as likely rather than guaranteed.
        </p>
      </div>
    </div>
  );
}
