#!/usr/bin/env node
// audit-team-colors.mjs — encode my hand-audited color picks (run after fetch).
// RULES (recorded; every pick MUST be one of the extracted candidates):
//  1. white-field rule: near-white never primary (JP/KR/EN/AT...)
//  2. primary = dominant flag field; ties broken toward national kit identity (noted)
//  3. flag colors only (e.g. Netherlands stays red/blue — Oranje is kit, not flag; noted)
//  4. missing-from-extraction colors are never invented; nearest extracted or neutral fallback, noted
// Flag-color facts are verifiable against each flag's documentation; the
// Twemoji file in each row is the pinned color source.

import { readFileSync, writeFileSync } from 'node:fs';
import { adjustForContrast } from './brand-tokens.mjs';

const d = JSON.parse(readFileSync('data/team-colors.json', 'utf8'));
const WHITE = '#eeeeee';
const NEUTRAL = '#d7dadd';

// slug -> [primary, secondary, note]
const AUDIT = {
  'algeria': ['#006233', '#d20f34', 'green field primary; red star/crescent secondary'],
  'argentina': ['#75aadb', '#fcbf49', 'celeste primary (white band is neutral-excluded); Sun of May gold secondary'],
  'australia': ['#00247d', '#cf1b2b', 'navy field primary'],
  'austria': ['#ed2939', WHITE, 'white-field rule: red primary, white band secondary'],
  'belgium': ['#141414', '#fdda24', 'black-yellow-red tricolour in flag order'],
  'bosnia-and-herzegovina': ['#2d3189', '#fbd116', 'blue field + yellow triangle'],
  'brazil': ['#009b3a', '#fedf01', 'green field + yellow rhombus'],
  'cabo-verde': ['#003893', '#cf2027', 'blue field primary; red stripe secondary (yellow stars beyond extraction)'],
  'canada': ['#d52b1e', WHITE, 'red maple primary'],
  'colombia': ['#fbd116', '#22408c', 'yellow upper half primary; blue secondary'],
  'congo-dr': ['#007fff', '#ce1021', 'sky-blue field; red diagonal secondary'],
  'cote-d-ivoire': ['#f77f00', '#009e60', 'orange-white-green in flag order'],
  'croatia': ['#d52b1e', '#171796', 'kit-identity tiebreak: checkerboard red primary over proxy blue'],
  'curacao': ['#002b7f', '#f9e814', 'blue field + yellow stripe'],
  'czechia': ['#d7141a', '#11457e', 'red band primary; blue wedge secondary'],
  'ecuador': ['#ffdd00', '#034ea2', 'yellow half primary (condor brown demoted); blue secondary'],
  'egypt': ['#ce1225', '#141414', 'red-white-black tricolour; white-field excluded; gold eagle beyond pair'],
  'england': ['#ce1124', WHITE, 'white-field rule: St George red primary'],
  'france': ['#002495', '#ed2939', 'kit-identity tiebreak: Les Bleus blue primary over proxy red'],
  'germany': ['#141414', '#ed1f24', 'black-red-gold in flag order; gold tertiary in candidates'],
  'ghana': ['#cc212d', '#fbd116', 'red-gold-green in flag order'],
  'haiti': ['#00209f', '#d21c33', 'blue-over-red bicolour in flag order (proxy had red first)'],
  'ir-iran': ['#239f40', '#da0001', 'green-white-red in flag order (proxy had red first)'],
  'iraq': ['#dd2e44', '#141414', 'red-white-black in flag order (proxy had black first)'],
  'japan': ['#ed1b2f', NEUTRAL, 'white-field rule: hinomaru red primary; neutral secondary (flag has no second color)'],
  'jordan': ['#141414', '#007a3d', 'black-white-green bands in flag order; red chevron in candidates as tertiary'],
  'korea-republic': ['#c60c30', '#003478', 'white-field rule: taegeuk red primary, blue secondary'],
  'mexico': ['#006847', '#ce1126', 'green band primary; red band secondary (top-6 re-extraction recovered red)'],
  'morocco': ['#c1272d', '#006233', 'red field + green pentagram'],
  'netherlands': ['#ae1f28', '#20478b', 'flag colors only: red band primary, blue secondary (Oranje is kit, not flag)'],
  'new-zealand': ['#00247d', '#cf1b2b', 'navy field primary (proxy had star red first)'],
  'norway': ['#ef2b2d', '#002868', 'red field primary; indigo cross secondary'],
  'panama': ['#d21034', '#005293', 'quarters tie broken toward La Marea Roja kit red'],
  'paraguay': ['#0038a8', '#007127', 'red band beyond extraction; blue band primary, emblem green secondary (noted)'],
  'portugal': ['#d52b1e', '#006600', 'red field primary (larger panel + kit); green hoist secondary'],
  'qatar': ['#8d1b3d', WHITE, 'maroon primary'],
  'saudi-arabia': ['#006c35', NEUTRAL, 'green field primary; flag has no second color — neutral secondary'],
  'scotland': ['#0065bd', WHITE, 'saltire blue primary'],
  'senegal': ['#00853f', '#fdef42', 'green-yellow-red in flag order'],
  'south-africa': ['#007a4d', '#ffb611', 'sporting green/gold pair from the six-color flag (top-6 recovered both)'],
  'spain': ['#c60a1d', '#ffc400', 'rojigualda red primary, gold secondary (crest pink tones demoted)'],
  'sweden': ['#006aa7', '#fecc00', 'blue field + yellow cross'],
  'switzerland': ['#d32d27', NEUTRAL, 'red field; white cross is neutral-excluded — neutral secondary'],
  'tunisia': ['#e70013', NEUTRAL, 'red field; white disc neutral-excluded'],
  'turkiye': ['#e30917', WHITE, 'red field primary; white crescent-star secondary'],
  'uruguay': ['#0038a8', '#ffac33', 'blue stripes primary; Sun of May gold secondary'],
  'usa': ['#3c3b6e', '#b22334', 'canton navy primary; stripe red secondary'],
  'uzbekistan': ['#0099b5', '#1eb53a', 'azure band primary; green band secondary'],
};

let fixed = 0;
for (const [slug, t] of Object.entries(d.teams)) {
  const a = AUDIT[slug];
  if (!a) { console.error(`⛔ no audit decision for ${slug}`); process.exit(1); }
  const [primary, secondary, note] = a;
  for (const hex of [primary, secondary]) {
    if (hex !== WHITE && hex !== NEUTRAL && !t.colors.includes(hex)) {
      console.error(`⛔ ${slug}: audited hex ${hex} not among extracted candidates ${t.colors}`);
      process.exit(1);
    }
  }
  t.ui = { primary, secondary, onLight: adjustForContrast(primary, 'onLight'), onDark: adjustForContrast(primary, 'onDark') };
  t.audited = true;
  t.note = note;
  fixed++;
}
d.source.audited_at = new Date().toISOString();
d.source.audit_rules = 'white-field rule; flag-dominant primary; kit-identity tiebreaks noted; picks constrained to extracted candidates or declared neutrals';
writeFileSync('data/team-colors.json', JSON.stringify(d, null, 1) + '\n');
console.log(`audited ${fixed}/48 — all rows audited:true`);
