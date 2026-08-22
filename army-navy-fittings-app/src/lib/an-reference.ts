/**
 * AN dash-size reference.
 *
 * The AN (Army-Navy) dash number is the tube outside diameter in sixteenths of
 * an inch: -8 is 8/16" = 1/2" tube. The thread is the standard 37° JIC flare
 * thread for that size, and hose ID is the nominal bore of braided hose built
 * for it.
 *
 * These are the published standard figures rather than measurements of any one
 * supplier's stock, which is why the guide tells you to check the part before
 * cutting hose.
 */
export interface AnSize {
  dash: number;
  /** Tube outside diameter, imperial. */
  tubeOd: string;
  /** Male thread, UNF/UN. */
  thread: string;
  /** Nominal hose bore. */
  hoseIdImperial: string;
  hoseIdMetric: string;
}

export const AN_SIZES: AnSize[] = [
  { dash: 2, tubeOd: '1/8"', thread: '5/16"-24', hoseIdImperial: '1/16"', hoseIdMetric: '1.6 mm' },
  { dash: 3, tubeOd: '3/16"', thread: '3/8"-24', hoseIdImperial: '1/8"', hoseIdMetric: '3.2 mm' },
  { dash: 4, tubeOd: '1/4"', thread: '7/16"-20', hoseIdImperial: '7/32"', hoseIdMetric: '5.6 mm' },
  { dash: 5, tubeOd: '5/16"', thread: '1/2"-20', hoseIdImperial: '9/32"', hoseIdMetric: '7.1 mm' },
  { dash: 6, tubeOd: '3/8"', thread: '9/16"-18', hoseIdImperial: '11/32"', hoseIdMetric: '8.7 mm' },
  { dash: 8, tubeOd: '1/2"', thread: '3/4"-16', hoseIdImperial: '7/16"', hoseIdMetric: '11.1 mm' },
  { dash: 10, tubeOd: '5/8"', thread: '7/8"-14', hoseIdImperial: '9/16"', hoseIdMetric: '14.3 mm' },
  { dash: 12, tubeOd: '3/4"', thread: '1 1/16"-12', hoseIdImperial: '11/16"', hoseIdMetric: '17.5 mm' },
  { dash: 16, tubeOd: '1"', thread: '1 5/16"-12', hoseIdImperial: '7/8"', hoseIdMetric: '22.2 mm' },
  { dash: 20, tubeOd: '1 1/4"', thread: '1 5/8"-12', hoseIdImperial: '1 1/8"', hoseIdMetric: '28.6 mm' },
  { dash: 24, tubeOd: '1 1/2"', thread: '1 7/8"-12', hoseIdImperial: '1 5/16"', hoseIdMetric: '33.3 mm' },
  { dash: 32, tubeOd: '2"', thread: '2 1/2"-12', hoseIdImperial: '1 3/4"', hoseIdMetric: '44.5 mm' },
];

export function findAnSize(dash: number): AnSize | undefined {
  return AN_SIZES.find((s) => s.dash === dash);
}

/** Bend angles the shop stocks hose ends in, in catalogue order. */
export const BEND_ANGLES = [0, 20, 30, 45, 60, 90, 120, 150, 180];

export function angleLabel(angle: number): string {
  return angle === 0 ? 'Straight' : `${angle}°`;
}
