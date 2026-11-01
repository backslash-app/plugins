// SGP4: where a satellite is at a given time from its two-line element set
// (TLE). The near-Earth part of the reference implementation (Vallado,
// Crawford, Hujsak and Kelso, "Revisiting Spacetrack Report #3", 2006, with
// WGS 72 constants): what the ISS, on a 93-minute orbit, needs. Positions
// are in the TEME frame, km, velocities km/s. Pure, tested in lib_test.ts.

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
const MINUTES_PER_DAY = 1440;

// WGS 72, as the elements are fitted with it.
const MU = 398600.8;
export const EARTH_RADIUS_KM = 6378.135;
const XKE = 60 / Math.sqrt((EARTH_RADIUS_KM ** 3) / MU);
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const X2O3 = 2 / 3;
const VKMPERSEC = (EARTH_RADIUS_KM * XKE) / 60;

export interface Tle {
  name?: string;
  line1: string;
  line2: string;
  /** NORAD catalog number. */
  id: number;
  /** Epoch of the elements, ms since 1970 (UTC). */
  epoch: number;
  inclination: number;
  raan: number;
  eccentricity: number;
  argPerigee: number;
  meanAnomaly: number;
  /** Revolutions a day. */
  meanMotion: number;
  bstar: number;
}

/** The checksum digit of a TLE line: digits add their value, minus signs 1, modulo 10. */
export function tleChecksum(line: string): number {
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= "0" && ch <= "9") sum += Number(ch);
    else if (ch === "-") sum += 1;
  }
  return sum % 10;
}

/** " 13267-3" → 0.13267e-3: TLE's implied decimal point and exponent. */
function impliedDecimal(field: string): number {
  const s = field.trim();
  if (!s) return 0;
  const m = /^([+-]?)(\d+)([+-]\d)$/.exec(s);
  if (!m) return Number(s);
  return Number(`${m[1]}0.${m[2]}e${m[3]}`);
}

/** Reads a TLE: the optional name line, then lines 1 and 2. Throws on a malformed set. */
export function parseTle(text: string): Tle {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const i1 = lines.findIndex((l) => l.startsWith("1 "));
  if (i1 < 0 || !lines[i1 + 1]?.startsWith("2 ")) throw new Error("Not a two-line element set");
  const line1 = lines[i1];
  const line2 = lines[i1 + 1];
  if (line1.length < 69 || line2.length < 69) throw new Error("A TLE line is too short");
  for (const line of [line1, line2]) {
    if (tleChecksum(line) !== Number(line[68])) throw new Error(`Bad checksum on TLE line ${line[0]}`);
  }
  const yy = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const epoch = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000;
  return {
    name: i1 > 0 ? lines[i1 - 1].trim() : undefined,
    line1,
    line2,
    id: Number(line1.slice(2, 7)),
    epoch: Math.round(epoch),
    bstar: impliedDecimal(line1.slice(53, 61)),
    inclination: Number(line2.slice(8, 16)),
    raan: Number(line2.slice(17, 25)),
    eccentricity: Number(`0.${line2.slice(26, 33).trim()}`),
    argPerigee: Number(line2.slice(34, 42)),
    meanAnomaly: Number(line2.slice(43, 51)),
    meanMotion: Number(line2.slice(52, 63)),
  };
}

export const julianDate = (ms: number) => ms / 86_400_000 + 2440587.5;

/** Greenwich mean sidereal time, radians (IAU 1982, as SGP4 uses). */
export function gmst(ms: number): number {
  const t = (julianDate(ms) - 2451545) / 36525;
  let s = -6.2e-6 * t ** 3 + 0.093104 * t * t + (876600 * 3600 + 8640184.812866) * t + 67310.54841;
  s = ((s * DEG) / 240) % TWO_PI;
  return s < 0 ? s + TWO_PI : s;
}

/** Everything SGP4 computes once per element set. */
export interface Satrec {
  tle: Tle;
  epoch: number;
  bstar: number;
  ecco: number;
  inclo: number;
  nodeo: number;
  argpo: number;
  mo: number;
  noUnkozai: number;
  isimp: boolean;
  con41: number;
  x1mth2: number;
  x7thm1: number;
  cc1: number;
  cc4: number;
  cc5: number;
  d2: number;
  d3: number;
  d4: number;
  delmo: number;
  eta: number;
  argpdot: number;
  omgcof: number;
  sinmao: number;
  t2cof: number;
  t3cof: number;
  t4cof: number;
  t5cof: number;
  mdot: number;
  nodedot: number;
  nodecf: number;
  xlcof: number;
  aycof: number;
  xmcof: number;
}

export function satrec(tle: Tle): Satrec {
  const ecco = tle.eccentricity;
  const inclo = tle.inclination * DEG;
  const nodeo = tle.raan * DEG;
  const argpo = tle.argPerigee * DEG;
  const mo = tle.meanAnomaly * DEG;
  const noKozai = (tle.meanMotion * TWO_PI) / MINUTES_PER_DAY;
  if ((TWO_PI / noKozai) >= 225) {
    throw new Error("Deep-space orbits (periods of 225 minutes or more) are not supported");
  }
  const bstar = tle.bstar;

  // initl: recover the original mean motion and semi-major axis.
  const eccsq = ecco * ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(inclo);
  const cosio2 = cosio * cosio;
  const ak = (XKE / noKozai) ** X2O3;
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  const noUnkozai = noKozai / (1 + del);
  const ao = (XKE / noUnkozai) ** X2O3;
  const sinio = Math.sin(inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - ecco);

  // sgp4init
  const ss = 78 / EARTH_RADIUS_KM + 1;
  const qzms2t = ((120 - 78) / EARTH_RADIUS_KM) ** 4;
  const isimp = rp < 220 / EARTH_RADIUS_KM + 1;
  let sfour = ss;
  let qzms24 = qzms2t;
  const perige = (rp - 1) * EARTH_RADIUS_KM;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = ((120 - sfour) / EARTH_RADIUS_KM) ** 4;
    sfour = sfour / EARTH_RADIUS_KM + 1;
  }
  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * tsi ** 4;
  const coef1 = coef / psisq ** 3.5;
  const cc2 = coef1 * noUnkozai *
    (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
      ((0.375 * J2 * tsi) / psisq) * con41 * (8 + 3 * etasq * (8 + etasq)));
  const cc1 = bstar * cc2;
  const cc3 = ecco > 1e-4 ? (-2 * coef * tsi * J3OJ2 * noUnkozai * sinio) / ecco : 0;
  const x1mth2 = 1 - cosio2;
  const cc4 = 2 * noUnkozai * coef1 * ao * omeosq *
    (eta * (2 + 0.5 * etasq) + ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
          0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * noUnkozai;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * noUnkozai;
  const mdot = noUnkozai + 0.5 * temp1 * rteosq * con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
    temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  const omgcof = bstar * cc3 * Math.cos(argpo);
  const xmcof = ecco > 1e-4 ? (-X2O3 * coef * bstar) / eeta : 0;
  const nodecf = 3.5 * omeosq * xhdot1 * cc1;
  const t2cof = 1.5 * cc1;
  const xlcof = Math.abs(cosio + 1) > 1.5e-12
    ? (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / (1 + cosio)
    : (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / 1.5e-12;
  const aycof = -0.5 * J3OJ2 * sinio;
  const delmo = (1 + eta * Math.cos(mo)) ** 3;
  const sinmao = Math.sin(mo);
  const x7thm1 = 7 * cosio2 - 1;

  let d2 = 0, d3 = 0, d4 = 0, t3cof = 0, t4cof = 0, t5cof = 0;
  if (!isimp) {
    const cc1sq = cc1 * cc1;
    d2 = 4 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3;
    d3 = (17 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
    t3cof = d2 + 2 * cc1sq;
    t4cof = 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq));
    t5cof = 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq));
  }

  return {
    tle,
    epoch: tle.epoch,
    bstar,
    ecco,
    inclo,
    nodeo,
    argpo,
    mo,
    noUnkozai,
    isimp,
    con41,
    x1mth2,
    x7thm1,
    cc1,
    cc4,
    cc5,
    d2,
    d3,
    d4,
    delmo,
    eta,
    argpdot,
    omgcof,
    sinmao,
    t2cof,
    t3cof,
    t4cof,
    t5cof,
    mdot,
    nodedot,
    nodecf,
    xlcof,
    aycof,
    xmcof,
  };
}

export interface StateVector {
  /** Position and velocity in the TEME frame, km and km/s. */
  position: [number, number, number];
  velocity: [number, number, number];
}

/** Propagates `minutes` after the epoch. Throws when the orbit has decayed. */
export function propagate(s: Satrec, minutes: number): StateVector {
  const t = minutes;
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;
  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delmtemp = 1 + s.eta * Math.cos(xmdf);
    const delm = s.xmcof * (delmtemp ** 3 - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }
  let nm = s.noUnkozai;
  let em = s.ecco;
  const inclm = s.inclo;
  const am = (XKE / nm) ** X2O3 * tempa * tempa;
  nm = XKE / am ** 1.5;
  em = em - tempe;
  if (em >= 1 || em < -0.001) throw new Error("The orbit can't be computed this far from the elements' epoch");
  if (em < 1e-6) em = 1e-6;
  mm = mm + s.noUnkozai * templ;
  let xlm = mm + argpm + nodem;
  nodem %= TWO_PI;
  argpm %= TWO_PI;
  xlm %= TWO_PI;
  mm = (xlm - argpm - nodem) % TWO_PI;

  const sinip = Math.sin(inclm);
  const cosip = Math.cos(inclm);
  const axnl = em * Math.cos(argpm);
  let temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodem + temp * s.xlcof * axnl;

  // Kepler's equation for the long-period terms.
  const u = (xl - nodem) % TWO_PI;
  let eo1 = u;
  let tem5 = 9999.9;
  let sineo1 = 0;
  let coseo1 = 0;
  for (let k = 0; Math.abs(tem5) >= 1e-12 && k < 10; k++) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }

  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) throw new Error("The orbit can't be computed this far from the elements' epoch");
  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;

  // Short-period periodics.
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * temp2 * cosip * sin2u;
  const xinc = inclm + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / XKE;

  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  if (mrt < 1) throw new Error("The satellite has decayed");
  const r = mrt * EARTH_RADIUS_KM;
  return {
    position: [r * ux, r * uy, r * uz],
    velocity: [
      (mvt * ux + rvdot * vx) * VKMPERSEC,
      (mvt * uy + rvdot * vy) * VKMPERSEC,
      (mvt * uz + rvdot * vz) * VKMPERSEC,
    ],
  };
}

/** Where the satellite is at `ms` (UTC). */
export function propagateAt(s: Satrec, ms: number): StateVector {
  return propagate(s, (ms - s.epoch) / 60_000);
}
