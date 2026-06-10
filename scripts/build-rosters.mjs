#!/usr/bin/env node
// build-rosters.mjs — squad parser (zero dependencies).
// Parses all 48 final squads from the PINNED Wikipedia revision of
// "2026 FIFA World Cup squads" (CC BY-SA 4.0) into data/rosters.json.
// Aborts on any invariant failure; nothing partial is written.

import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Golazo26-planning/0.1 (contact: onwike@gmail.com)';
const REVID = 1358656369;
const API = `https://en.wikipedia.org/w/api.php?action=parse&oldid=${REVID}&prop=wikitext&format=json`;
const PERMALINK = `https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup_squads&oldid=${REVID}`;

// Wikipedia heading -> canonical team name (fixturedownload/FIFA spelling),
// only where they differ. Identity for all others.
const HEADING_ALIASES = new Map([
  ['United States', 'USA'],
  ['South Korea', 'Korea Republic'],
  ['Czech Republic', 'Czechia'],
  ['Turkey', 'Türkiye'],
  ['Ivory Coast', "Côte d'Ivoire"],
  ['Iran', 'IR Iran'],
  ['Cape Verde', 'Cabo Verde'],
  ['DR Congo', 'Congo DR'],
]);

const EXPECTED_TEAMS = 48;
const EXPECTED_TOTAL = 1246; // 46 x 26 + ARG 25 + AUT 25 (fact-checked)
const SQUAD_25 = new Set(['Argentina', 'Austria']);

const errors = [];
const assert = (c, msg) => { if (!c) errors.push(msg); };

const res = await fetch(API, { headers: { 'User-Agent': UA } });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const wikitext = (await res.json()).parse.wikitext['*'];

// Split into level-3 sections; keep only those containing a squad table.
const sections = wikitext.split(/^===\s*([^=]+?)\s*===$/m);
const teams = [];
for (let i = 1; i < sections.length; i += 2) {
  const heading = sections[i].trim();
  const body = sections[i + 1] ?? '';
  if (!body.includes('{{nat fs g start}}')) continue;

  const canonical = HEADING_ALIASES.get(heading) ?? heading;

  // Coach line: "Coach: [[Name]]" or "Coach: {{flagicon|XXX}} [[Article|Display]]"
  const coachLine = body.match(/^Coach:.*$/m)?.[0] ?? '';
  const coachLinks = [...coachLine.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
    .filter((m) => !/captain/i.test(m[1]));
  const coachNat = coachLine.match(/\{\{flagicon\|(\w+)\}\}/)?.[1] ?? null;
  const coach = coachLinks.length
    ? { name: (coachLinks.at(-1)[2] ?? coachLinks.at(-1)[1]).trim(), wiki_title: coachLinks.at(-1)[1].trim(), nationality_code: coachNat }
    : null;
  assert(coach, `${canonical}: no coach parsed from "${coachLine}"`);

  const players = [];
  for (const pm of body.matchAll(/\{\{nat fs g player\s*\|([\s\S]*?)\}\}\n/g)) {
    const f = {};
    // top-level field split — pipes inside {{templates}} AND [[wikilinks]] are
    // not field separators (the [[A|B]] case broke 115 names before the audit)
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of pm[1]) {
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (ch === '|' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq > 0) f[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
    }
    const nameLink = (f.name ?? '').match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    const isCaptain = /captain/i.test(f.other ?? '') || /captain/i.test(f.name ?? '');
    const dobM = (f.age ?? '').match(/birth date and age2\|\d{4}\|\d{1,2}\|\d{1,2}\|(\d{4})\|(\d{1,2})\|(\d{1,2})/);
    const clubLink = (f.club ?? '').match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    players.push({
      no: Number(f.no),
      pos: f.pos,
      name: nameLink ? (nameLink[2] ?? nameLink[1]).trim() : (f.name ?? '').trim(),
      wiki_title: nameLink ? nameLink[1].trim() : null,
      captain: isCaptain || undefined,
      dob: dobM ? `${dobM[1]}-${String(dobM[2]).padStart(2, '0')}-${String(dobM[3]).padStart(2, '0')}` : null,
      caps: Number(f.caps),
      goals: Number(f.goals),
      club: clubLink ? (clubLink[2] ?? clubLink[1]).trim() : (f.club ?? '').trim(),
      club_country_code: f.clubnat || null,
    });
  }

  // per-team gates (all-or-nothing)
  const expected = SQUAD_25.has(canonical) ? 25 : 26;
  assert(players.length === expected, `${canonical}: ${players.length} players, expected ${expected}`);
  assert(players.filter((p) => p.pos === 'GK').length >= 3, `${canonical}: fewer than 3 GK`);
  for (const p of players) {
    assert(['GK', 'DF', 'MF', 'FW'].includes(p.pos), `${canonical}: bad pos ${p.pos} (${p.name})`);
    assert(p.no >= 1 && p.no <= 26, `${canonical}: bad shirt no ${p.no} (${p.name})`);
    assert(p.dob && p.dob >= '1980-01-01' && p.dob <= '2012-12-31', `${canonical}: implausible dob ${p.dob} (${p.name})`);
    assert(Number.isFinite(p.caps) && Number.isFinite(p.goals), `${canonical}: non-numeric caps/goals (${p.name})`);
    assert(p.name, `${canonical}: empty player name`);
    assert(!p.name.includes('[') && !p.club.includes('['), `${canonical}: wikitext leakage in name/club (${p.name} / ${p.club})`);
  }
  const nos = new Set(players.map((p) => p.no));
  assert(nos.size === players.length, `${canonical}: duplicate shirt numbers`);

  teams.push({ team: canonical, wiki_heading: heading, coach, players });
}

assert(teams.length === EXPECTED_TEAMS, `parsed ${teams.length} squad sections, expected ${EXPECTED_TEAMS}`);
const total = teams.reduce((s, t) => s + t.players.length, 0);
assert(total === EXPECTED_TOTAL, `total players ${total}, expected ${EXPECTED_TOTAL}`);
const captains = teams.filter((t) => t.players.some((p) => p.captain)).length;

if (errors.length) {
  console.error(`ABORT — ${errors.length} failure(s):`);
  for (const e of errors.slice(0, 40)) console.error('  ✗', e);
  process.exit(1);
}

mkdirSync('data', { recursive: true });
writeFileSync('data/rosters.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  source: {
    title: '2026 FIFA World Cup squads',
    revid: REVID,
    permalink: PERMALINK,
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  team_count: teams.length,
  player_count: total,
  teams: teams.sort((a, b) => a.team.localeCompare(b.team)),
}, null, 2) + '\n');

console.log(`OK — ${teams.length} squads, ${total} players, ${captains} teams with a marked captain`);
console.log('squad sizes:', teams.map((t) => `${t.team}:${t.players.length}`).join(' '));
