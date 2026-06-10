#!/usr/bin/env node
// build-matches.mjs — schedule data builder (zero dependencies).
// Seeds the schedule from openfootball (public domain), cross-checks every match
// against fixturedownload.com, and emits data/matches.json, data/venues.json,
// data/teams.json with per-record source URLs. Aborts on invariant failure:
// nothing partial is ever written.

import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Golazo26-planning/0.1 (contact: onwike@gmail.com)';
const OF_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
const FD_URL = 'https://fixturedownload.com/feed/json/fifa-world-cup-2026';
const WIKI_VENUES_URL = 'https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup&oldid=1358650246#Venues';

// Venue table: fifa_name from fixturedownload Location strings (verified live),
// common_name + city from Wikipedia pinned revision 1358650246 (Venues map),
// locality from openfootball ground qualifiers, tz = IANA zone for the city.
const VENUES = [
  { id: 'mexico-city',  fifa_name: 'Mexico City Stadium',            common_name: 'Estadio Azteca',          city: 'Mexico City',            locality: 'Mexico City',     country: 'MX', tz: 'America/Mexico_City' },
  { id: 'guadalajara',  fifa_name: 'Guadalajara Stadium',            common_name: 'Estadio Akron',           city: 'Guadalajara',            locality: 'Zapopan',         country: 'MX', tz: 'America/Mexico_City' },
  { id: 'monterrey',    fifa_name: 'Monterrey Stadium',              common_name: 'Estadio BBVA',            city: 'Monterrey',              locality: 'Guadalupe',       country: 'MX', tz: 'America/Monterrey' },
  { id: 'vancouver',    fifa_name: 'BC Place Vancouver',             common_name: 'BC Place',                city: 'Vancouver',              locality: 'Vancouver',       country: 'CA', tz: 'America/Vancouver' },
  { id: 'toronto',      fifa_name: 'Toronto Stadium',                common_name: 'BMO Field',               city: 'Toronto',                locality: 'Toronto',         country: 'CA', tz: 'America/Toronto' },
  { id: 'atlanta',      fifa_name: 'Atlanta Stadium',                common_name: 'Mercedes-Benz Stadium',   city: 'Atlanta',                locality: 'Atlanta',         country: 'US', tz: 'America/New_York' },
  { id: 'boston',       fifa_name: 'Boston Stadium',                 common_name: 'Gillette Stadium',        city: 'Boston',                 locality: 'Foxborough',      country: 'US', tz: 'America/New_York' },
  { id: 'dallas',       fifa_name: 'Dallas Stadium',                 common_name: 'AT&T Stadium',            city: 'Dallas',                 locality: 'Arlington',       country: 'US', tz: 'America/Chicago' },
  { id: 'houston',      fifa_name: 'Houston Stadium',                common_name: 'NRG Stadium',             city: 'Houston',                locality: 'Houston',         country: 'US', tz: 'America/Chicago' },
  { id: 'kansas-city',  fifa_name: 'Kansas City Stadium',            common_name: 'Arrowhead Stadium',       city: 'Kansas City',            locality: 'Kansas City',     country: 'US', tz: 'America/Chicago' },
  { id: 'los-angeles',  fifa_name: 'Los Angeles Stadium',            common_name: 'SoFi Stadium',            city: 'Los Angeles',            locality: 'Inglewood',       country: 'US', tz: 'America/Los_Angeles' },
  { id: 'miami',        fifa_name: 'Miami Stadium',                  common_name: 'Hard Rock Stadium',       city: 'Miami',                  locality: 'Miami Gardens',   country: 'US', tz: 'America/New_York' },
  { id: 'new-york-nj',  fifa_name: 'New York/New Jersey Stadium',    common_name: 'MetLife Stadium',         city: 'New York/New Jersey',    locality: 'East Rutherford', country: 'US', tz: 'America/New_York' },
  { id: 'philadelphia', fifa_name: 'Philadelphia Stadium',           common_name: 'Lincoln Financial Field', city: 'Philadelphia',           locality: 'Philadelphia',    country: 'US', tz: 'America/New_York' },
  { id: 'sf-bay-area',  fifa_name: 'San Francisco Bay Area Stadium', common_name: "Levi's Stadium",          city: 'San Francisco Bay Area', locality: 'Santa Clara',     country: 'US', tz: 'America/Los_Angeles' },
  { id: 'seattle',      fifa_name: 'Seattle Stadium',                common_name: 'Lumen Field',             city: 'Seattle',                locality: 'Seattle',         country: 'US', tz: 'America/Los_Angeles' },
];

// openfootball ground string -> venue id (city + optional locality qualifier)
const OF_GROUND_TO_VENUE = {
  'Mexico City': 'mexico-city',
  'Guadalajara (Zapopan)': 'guadalajara',
  'Monterrey (Guadalupe)': 'monterrey',
  'Vancouver': 'vancouver',
  'Toronto': 'toronto',
  'Atlanta': 'atlanta',
  'Boston (Foxborough)': 'boston',
  'Dallas (Arlington)': 'dallas',
  'Houston': 'houston',
  'Kansas City': 'kansas-city',
  'Los Angeles (Inglewood)': 'los-angeles',
  'Miami (Miami Gardens)': 'miami',
  'New York/New Jersey (East Rutherford)': 'new-york-nj',
  'Philadelphia': 'philadelphia',
  'San Francisco Bay Area (Santa Clara)': 'sf-bay-area',
  'Seattle': 'seattle',
};

// Team-name alias map between sources (filled only where the two disagree;
// every entry confirmed by the first-run cross-check report, never guessed).
// Canonical spelling = fixturedownload's FIFA-style names.
const ALIASES = new Map([
  ['South Korea', 'Korea Republic'],
  ['Czech Republic', 'Czechia'],
  ['Bosnia & Herzegovina', 'Bosnia and Herzegovina'],
  ['Turkey', 'Türkiye'],
  ['Ivory Coast', "Côte d'Ivoire"],
  ['Iran', 'IR Iran'],
  ['Cape Verde', 'Cabo Verde'],
  ['DR Congo', 'Congo DR'],
]);

// Source-disagreement resolutions: only entries where a third independent
// source breaks the tie (2-of-3 rule). Each carries the tiebreaker citation.
// Without an entry here, a kickoff mismatch ABORTS the build.
const RESOLUTIONS = new Map([
  [29, { kickoff_utc: '2026-06-20T00:30:00Z', rule: '2-of-3', agree: ['openfootball', 'wikipedia'], outlier: 'fixturedownload',
    tiebreaker_url: 'https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup_Group_C&oldid=1358266916',
    note: 'Brazil vs Haiti: Wikipedia (8:30 p.m. UTC-4, Jun 19) and openfootball agree on 00:30Z; fixturedownload says 01:00Z' }],
  [31, { kickoff_utc: '2026-06-20T03:00:00Z', rule: '2-of-3', agree: ['openfootball', 'wikipedia'], outlier: 'fixturedownload',
    tiebreaker_url: 'https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup_Group_D&oldid=1358651133',
    note: 'Türkiye vs Paraguay: Wikipedia (8:00 p.m. UTC-7, Jun 19) and openfootball agree on 03:00Z; fixturedownload says 04:00Z' }],
]);
const resolvedDiscrepancies = [];

const STAGE_BY_ROUND = new Map([
  ['Round of 32', 'r32'], ['Round of 16', 'r16'], ['Quarter-final', 'qf'],
  ['Semi-final', 'sf'], ['Match for third place', 'third'], ['Final', 'final'],
]);

// Team -> ISO 3166-1 alpha-2 (for Unicode flag emoji). England/Scotland use
// Unicode subdivision tag sequences (GB-ENG / GB-SCT). Audit-verified.
const TEAM_ISO = {
  'Algeria': 'DZ', 'Argentina': 'AR', 'Australia': 'AU', 'Austria': 'AT', 'Belgium': 'BE',
  'Bosnia and Herzegovina': 'BA', 'Brazil': 'BR', 'Cabo Verde': 'CV', 'Canada': 'CA',
  'Colombia': 'CO', 'Congo DR': 'CD', "Côte d'Ivoire": 'CI', 'Croatia': 'HR', 'Curaçao': 'CW',
  'Czechia': 'CZ', 'Ecuador': 'EC', 'Egypt': 'EG', 'England': 'GB-ENG', 'France': 'FR',
  'Germany': 'DE', 'Ghana': 'GH', 'Haiti': 'HT', 'IR Iran': 'IR', 'Iraq': 'IQ', 'Japan': 'JP',
  'Jordan': 'JO', 'Korea Republic': 'KR', 'Mexico': 'MX', 'Morocco': 'MA', 'Netherlands': 'NL',
  'New Zealand': 'NZ', 'Norway': 'NO', 'Panama': 'PA', 'Paraguay': 'PY', 'Portugal': 'PT',
  'Qatar': 'QA', 'Saudi Arabia': 'SA', 'Scotland': 'GB-SCT', 'Senegal': 'SN',
  'South Africa': 'ZA', 'Spain': 'ES', 'Sweden': 'SE', 'Switzerland': 'CH', 'Tunisia': 'TN',
  'Türkiye': 'TR', 'USA': 'US', 'Uruguay': 'UY', 'Uzbekistan': 'UZ',
};
function flagEmoji(iso) {
  if (iso === 'GB-ENG') return '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  if (iso === 'GB-SCT') return '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
  return [...iso].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

const errors = [];
const warnings = [];
const assert = (cond, msg) => { if (!cond) errors.push(msg); };

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// "13:00 UTC-6" + "2026-06-11" -> ISO UTC instant
function ofToUTC(date, time) {
  const m = time.match(/^(\d{1,2}):(\d{2}) UTC([+-]\d{1,2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`unparseable of time: ${time}`);
  const [, hh, mm, off, offMin] = m;
  const utcMs = Date.UTC(...date.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)), Number(hh), Number(mm))
    - (Number(off) * 60 + (Number(offMin) || 0) * Math.sign(Number(off))) * 60000;
  return new Date(utcMs).toISOString().replace('.000Z', 'Z');
}

// fd "2026-06-11 19:00:00Z" -> ISO UTC instant
const fdToUTC = (s) => new Date(s.replace(' ', 'T')).toISOString().replace('.000Z', 'Z');

// Placeholder labels -> readable text. Raw label is always preserved.
// openfootball: "1A", "2B", "3A/B/C/D/F", "W73", "L101".
// fixturedownload: "1A", "2B", "3ABCDF" (no slashes), or "To be announced".
function describePlaceholder(label) {
  let m;
  if ((m = label.match(/^1([A-L])$/))) return `Winner Group ${m[1]}`;
  if ((m = label.match(/^2([A-L])$/))) return `Runner-up Group ${m[1]}`;
  if ((m = label.match(/^3((?:[A-L]\/?)+)$/))) return `Third place, Group ${m[1].replace(/\//g, '').split('').join('/')}`;
  if ((m = label.match(/^W(\d+)$/))) return `Winner Match ${m[1]}`;
  if ((m = label.match(/^L(\d+)$/))) return `Loser Match ${m[1]}`;
  return null;
}

// canonical form for cross-source placeholder comparison ("3A/B/C" === "3ABC")
const canonPlaceholder = (label) => label.replace(/[^0-9A-Z]/g, '');

const norm = (name) => ALIASES.get(name) ?? name;

const of = await getJSON(OF_URL);
const fd = await getJSON(FD_URL);

assert(of.matches.length === 104, `openfootball matches=${of.matches.length}, expected 104`);
assert(fd.length === 104, `fixturedownload matches=${fd.length}, expected 104`);

// Index fd by MatchNumber, by group-stage team pair (unique — each pairing
// occurs once in the group stage; of dates are venue-LOCAL while fd dates are
// UTC, so dates cannot be part of the join key), and by kickoff+venue for the
// two openfootball knockout matches that carry no `num` (third place, final).
const fdByNum = new Map(fd.map((m) => [m.MatchNumber, m]));
const fdByPair = new Map();
for (const m of fd) {
  if (m.Group) fdByPair.set([m.HomeTeam, m.AwayTeam].sort().join('|'), m);
}
const fdByKickoffVenue = new Map(fd.map((m) => [`${fdToUTC(m.DateUtc)}|${m.Location}`, m]));

const matches = [];
const teamGroups = new Map(); // team name (fd spelling) -> group letter
const nameMismatches = [];

for (const m of of.matches) {
  const isGroup = /^Matchday \d+$/.test(m.round);
  const stage = isGroup ? 'group' : STAGE_BY_ROUND.get(m.round);
  assert(stage, `unknown round: ${m.round}`);

  const kickoffOf = ofToUTC(m.date, m.time);
  let fdm;
  if (isGroup) {
    fdm = fdByPair.get([norm(m.team1), norm(m.team2)].sort().join('|'));
    if (!fdm) {
      nameMismatches.push({ of: [m.team1, m.team2], of_local_date: m.date });
      continue;
    }
  } else if (m.num != null) {
    fdm = fdByNum.get(m.num);
    assert(fdm, `knockout match num ${m.num} not in fixturedownload`);
    if (!fdm) continue;
  } else {
    // third place + final carry no num in openfootball: join on kickoff+venue
    const venue = VENUES.find((v) => v.id === OF_GROUND_TO_VENUE[m.ground]);
    fdm = venue && fdByKickoffVenue.get(`${kickoffOf}|${venue.fifa_name}`);
    assert(fdm, `num-less knockout match (${m.round}) not joinable on kickoff+venue: ${m.date} ${m.time} ${m.ground}`);
    if (!fdm) continue;
  }

  const kickoffFd = fdToUTC(fdm.DateUtc);
  let kickoff = kickoffFd;
  if (kickoffOf !== kickoffFd) {
    const res = RESOLUTIONS.get(fdm.MatchNumber);
    if (res && (res.kickoff_utc === kickoffOf || res.kickoff_utc === kickoffFd)) {
      kickoff = res.kickoff_utc;
      resolvedDiscrepancies.push({
        match_no: fdm.MatchNumber, field: 'kickoff_utc',
        openfootball: kickoffOf, fixturedownload: kickoffFd,
        resolved_value: kickoff, ...res,
      });
    } else {
      assert(false, `match ${fdm.MatchNumber}: kickoff mismatch of=${kickoffOf} fd=${kickoffFd} (no resolution on file)`);
    }
  }

  const venueId = OF_GROUND_TO_VENUE[m.ground];
  assert(venueId, `unknown of ground: ${m.ground}`);
  const venue = VENUES.find((v) => v.id === venueId);
  assert(venue && venue.fifa_name === fdm.Location, `match ${fdm.MatchNumber}: venue mismatch of=${m.ground} fd=${fdm.Location}`);

  if (isGroup) {
    const g = m.group.replace('Group ', '');
    assert(fdm.Group === m.group, `match ${fdm.MatchNumber}: group mismatch of=${m.group} fd=${fdm.Group}`);
    for (const t of [norm(m.team1), norm(m.team2)]) {
      const prev = teamGroups.get(t);
      assert(!prev || prev === g, `team ${t} in two groups: ${prev}, ${g}`);
      teamGroups.set(t, g);
    }
  }

  const side = (ofLabel, fdName) => {
    if (isGroup) return { team: norm(ofLabel) };
    const desc = describePlaceholder(ofLabel);
    assert(desc, `unparseable of placeholder: ${ofLabel}`);
    const fdIsPlaceholder = fdName === 'To be announced' || !!describePlaceholder(fdName);
    if (!fdIsPlaceholder) return { team: fdName, placeholder_was: ofLabel }; // slot resolved upstream
    if (fdName !== 'To be announced') {
      assert(canonPlaceholder(fdName) === canonPlaceholder(ofLabel),
        `match ${fdm.MatchNumber}: placeholder mismatch of=${ofLabel} fd=${fdName}`);
    }
    return { placeholder: ofLabel, placeholder_text: desc };
  };

  matches.push({
    match_no: fdm.MatchNumber,
    stage,
    ...(isGroup ? { group: m.group.replace('Group ', ''), matchday: Number(m.round.replace('Matchday ', '')) } : {}),
    kickoff_utc: kickoff,
    venue_id: venueId,
    home: side(m.team1, fdm.HomeTeam),
    away: side(m.team2, fdm.AwayTeam),
    score: null,
    status: 'scheduled',
    sources: { schedule: [OF_URL, FD_URL] },
  });
}

// ---- invariants (G1-G3) ----
assert(matches.length === 104, `joined matches=${matches.length}, expected 104`);
const byStage = {};
for (const m of matches) byStage[m.stage] = (byStage[m.stage] || 0) + 1;
const expectStage = { group: 72, r32: 16, r16: 8, qf: 4, sf: 2, third: 1, final: 1 };
for (const [s, n] of Object.entries(expectStage)) assert(byStage[s] === n, `stage ${s}=${byStage[s]}, expected ${n}`);
assert(teamGroups.size === 48, `teams=${teamGroups.size}, expected 48`);
const groupCounts = {};
for (const g of teamGroups.values()) groupCounts[g] = (groupCounts[g] || 0) + 1;
assert(Object.keys(groupCounts).length === 12 && Object.values(groupCounts).every((n) => n === 4),
  `group composition wrong: ${JSON.stringify(groupCounts)}`);
const opener = matches.find((m) => m.match_no === 1);
assert(opener && opener.home.team === 'Mexico' && opener.away.team === 'South Africa'
  && opener.kickoff_utc === '2026-06-11T19:00:00Z' && opener.venue_id === 'mexico-city',
  `opener invariant failed: ${JSON.stringify(opener)}`);
const final = matches.find((m) => m.match_no === 104);
assert(final && final.stage === 'final' && final.kickoff_utc === '2026-07-19T19:00:00Z' && final.venue_id === 'new-york-nj',
  `final invariant failed: ${JSON.stringify(final)}`);

if (nameMismatches.length) {
  console.error('TEAM NAME MISMATCHES (add to ALIASES after confirming):');
  for (const x of nameMismatches) console.error(' ', JSON.stringify(x));
}
if (errors.length) {
  console.error(`\nABORT — ${errors.length} invariant failure(s):`);
  for (const e of errors) console.error('  ✗', e);
  process.exit(1);
}

// ---- emit ----
mkdirSync('data', { recursive: true });
const generated_at = new Date().toISOString();

const venuesOut = {
  generated_at,
  sources: {
    fifa_name: FD_URL,
    common_name_and_city: WIKI_VENUES_URL,
    locality: OF_URL,
  },
  venues: VENUES,
};
writeFileSync('data/venues.json', JSON.stringify(venuesOut, null, 2) + '\n');

for (const name of teamGroups.keys()) assert(TEAM_ISO[name], `no ISO code mapped for team: ${name}`);
const teams = [...teamGroups.entries()]
  .map(([name, group]) => ({
    name,
    slug: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    group,
    iso: TEAM_ISO[name],
    flag: flagEmoji(TEAM_ISO[name]),
    sources: { name_and_group: [OF_URL, FD_URL] },
  }))
  .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
writeFileSync('data/teams.json', JSON.stringify({ generated_at, count: teams.length, teams }, null, 2) + '\n');

matches.sort((a, b) => a.match_no - b.match_no);
writeFileSync('data/matches.json', JSON.stringify({ generated_at, count: matches.length, matches }, null, 2) + '\n');

writeFileSync('data/discrepancies.json', JSON.stringify({ generated_at, resolved: resolvedDiscrepancies, open: [] }, null, 2) + '\n');

console.log('OK — all invariants passed');
if (resolvedDiscrepancies.length) console.log(`resolved discrepancies (2-of-3 documented): ${resolvedDiscrepancies.map((d) => d.match_no).join(', ')}`);
console.log(`matches=${matches.length} stages=${JSON.stringify(byStage)} teams=${teams.length} venues=${VENUES.length}`);
console.log('teams by group:');
for (const g of [...new Set(teams.map((t) => t.group))]) {
  console.log(`  ${g}: ${teams.filter((t) => t.group === g).map((t) => t.name).join(', ')}`);
}
