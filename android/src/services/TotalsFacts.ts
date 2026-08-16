// Faithful TS port of desktop/qml/TotalsFacts.qml - real request, 2026-08-11 (André):
// "Propose funny/random/outdoorish quotes to that equivalent (ex: that is the same distance
// of going to the moon and back... be factual and creative)". Every constant carries its
// real source in the desktop original; kept here verbatim so the Android Totals screen shows
// exactly the same sourced equivalents, not a re-invented set. Anything that could not be
// sourced was left out there and stays out here.
//
// Note what the CO2 line does and does not claim (same as desktop): it is what a car WOULD
// have emitted over the same distance, not a saving.

// --- distance references, metres ---------------------------------------------------
const MOON_RETURN = 768800000;        // mean centre-to-centre 384,400 km, doubled
const MOON_ONE_WAY = 384400000;
const PORTUGAL_LENGTH = 561000;       // Caminha -> Vila Real de Santo António, ~561 km
const EARTH_CIRCUMFERENCE = 40075000; // equatorial, WGS-84
const CAR_YEAR_PORTUGAL = 10000000;   // ~10,000 km/car/year (local figure)
const MARATHON = 42195;               // exactly 42.195 km
const CAMINO = 780000;                // Camino Francés, ~780 km
const CAR_CO2_PER_KM = 120;           // EU new-car fleet-average g/km

// --- energy references, kcal -------------------------------------------------------
const CHOCOLATE_BAR = 230;  // ~45 g milk chocolate bar
const GUMMY_BEAR = 3.5;     // ~1 g each
const BANANA = 105;         // medium, ~118 g
const PASTEL_DE_NATA = 300; // a real one
const PIZZA_SLICE = 285;    // one slice, regular cheese pizza
const BEER = 150;           // 330 ml lager

// desktop's _n(): a locale-grouped number with a fixed number of decimals. Uses the same
// forced 'en-GB' grouping the rest of the app already formats dates with (see i18n's
// dateLocale) so a big total reads as "1,234" not "1234".
function n(value: number, decimals = 0): string {
  return Number(value).toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Distance equivalents, best-fitting first. Exact port of desktop distanceLines().
export function distanceLines(meters: number): string[] {
  if (!meters || meters <= 0) return [];
  const out: string[] = [];

  if (meters >= MOON_RETURN)
    out.push(`That is the Moon and back - ${n(meters / MOON_RETURN, 1)} times over.`);
  else if (meters >= MOON_ONE_WAY * 0.02)
    out.push(`That is ${n((meters / MOON_ONE_WAY) * 100, 1)}% of the way to the Moon.`);

  if (meters >= EARTH_CIRCUMFERENCE)
    out.push(`You have been around the world ${n(meters / EARTH_CIRCUMFERENCE, 1)} times.`);

  if (meters >= PORTUGAL_LENGTH)
    out.push(`That is the length of Portugal ${n(meters / PORTUGAL_LENGTH, 1)} times over.`);
  else
    out.push(`That is ${n((meters / PORTUGAL_LENGTH) * 100, 0)}% of the length of Portugal.`);

  if (meters >= CAMINO * 0.25)
    out.push(`The Camino to Santiago is 780 km - you are at ${n((meters / CAMINO) * 100, 0)}% of it.`);

  if (meters >= MARATHON)
    out.push(`That is ${n(meters / MARATHON, 1)} marathons.`);

  out.push(
    `A car covering that would have put out about ${n((meters / 1000) * CAR_CO2_PER_KM / 1000, 0)} kg of CO2 - yours put out none.`,
  );
  out.push(
    `The average car in Portugal does ${n(CAR_YEAR_PORTUGAL / 1000, 0)} km a year. ` +
    `You did ${n((meters / CAR_YEAR_PORTUGAL) * 100, 0)}% of that under your own power.`,
  );
  return out;
}

// Energy equivalents (kcal). Exact port; unused on Android today (GPX-derived activities
// carry no kcal), kept so a future energy source lights the card up for free.
export function energyLines(kcal: number): string[] {
  if (!kcal || kcal <= 0) return [];
  return [
    `That is ${n(kcal / CHOCOLATE_BAR, 0)} bars of chocolate.`,
    `Or ${n(kcal / GUMMY_BEAR, 0)} gummy bears, if you would rather.`,
    `Or ${n(kcal / PASTEL_DE_NATA, 0)} pastéis de nata. You have earned them.`,
    `Or ${n(kcal / BANANA, 0)} bananas.`,
    `Or ${n(kcal / PIZZA_SLICE, 0)} slices of pizza.`,
    `Or ${n(kcal / BEER, 0)} beers - purely as a unit of measurement.`,
  ];
}

// Hours outside. Exact port of desktop hoursLines(); the days-in-a-year one is the headline
// André asked for.
export function hoursLines(hours: number): string[] {
  if (!hours || hours <= 0) return [];
  const out = [`That is ${n(hours / 24, 1)} full days outside this year.`];
  out.push(`Which is ${n((hours / 8760) * 100, 1)}% of the entire year.`);
  if (hours >= 8) out.push(`Or ${n(hours / 8, 0)} working days, if a day were spent well.`);
  return out;
}
