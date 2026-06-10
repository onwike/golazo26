#!/usr/bin/env node
// seed-d1.mjs — D1 seed generator (zero dependencies).
// Emits /tmp/g26-seed.sql from the audited datasets, re-asserting the hard
// invariants (G3) before a single row is written. Idempotent (DELETE+INSERT
// per table). Execute with:
//   npx wrangler d1 execute g26-db --remote --file=migrations/0001_schema.sql
//   npx wrangler d1 execute g26-db --remote --file=/tmp/g26-seed.sql

import { readFileSync, writeFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const matches = load('data/matches.json').matches;
const venues = load('data/venues.json').venues;
const teams = load('data/teams.json').teams;
const rosters = load('data/rosters.json');
const broadcasts = load('data/broadcasts.json').rows;
const fifa = load('data/people-fifa.json');
const ussf = load('data/people-ussf.json');
const images = load('data/images.json').entries;
const disc = load('data/discrepancies.json');
const manifest = load('data/img-manifest.json').manifest ?? {};

// hard invariant gates before anything is emitted
const fail = (m) => { console.error('⛔', m); process.exit(1); };
if (matches.length !== 104) fail(`matches=${matches.length}`);
if (teams.length !== 48) fail(`teams=${teams.length}`);
if (venues.length !== 16) fail(`venues=${venues.length}`);
const totalPlayers = rosters.teams.reduce((s, t) => s + t.players.length, 0);
if (totalPlayers !== 1246) fail(`players=${totalPlayers}`);
if (broadcasts.length !== 104) fail(`broadcast rows=${broadcasts.length}`);

const q = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const lines = [];
const ins = (table, cols, rows) => {
  lines.push(`DELETE FROM ${table};`);
  for (let i = 0; i < rows.length; i += 40) {
    lines.push(`INSERT INTO ${table} (${cols.join(',')}) VALUES\n` +
      rows.slice(i, i + 40).map((r) => `(${r.map(q).join(',')})`).join(',\n') + ';');
  }
};

ins('venues', ['id','fifa_name','common_name','city','locality','country','tz'],
  venues.map((v) => [v.id, v.fifa_name, v.common_name, v.city, v.locality, v.country, v.tz]));

ins('teams', ['name','slug','group_letter','iso','flag'],
  teams.map((t) => [t.name, t.slug, t.group, t.iso, t.flag]));

ins('matches', ['match_no','stage','group_letter','matchday','kickoff_utc','venue_id','home_team','away_team','home_placeholder','away_placeholder','status','updated_at'],
  matches.map((m) => [m.match_no, m.stage, m.group ?? null, m.matchday ?? null, m.kickoff_utc, m.venue_id,
    m.home.team ?? null, m.away.team ?? null, m.home.placeholder ?? null, m.away.placeholder ?? null,
    'scheduled', new Date().toISOString()]));

ins('broadcasts', ['match_no','region','us_english','us_spanish','source_url','verified_by','verified_at','notes'],
  broadcasts.map((b) => [b.n, 'US', b.us_english, b.us_spanish, b.source_url, b.verified_by, b.verified_at, b.notes ?? null]));

const playerRows = [];
const staffRows = [];
for (const t of rosters.teams) {
  for (const p of t.players) playerRows.push([t.team, p.no, p.pos, p.name, p.wiki_title, p.captain ? 1 : 0, p.dob, p.caps, p.goals, p.club, p.club_country_code]);
  if (t.coach) staffRows.push([t.team, 'Head coach', t.coach.name, t.coach.wiki_title, t.coach.nationality_code]);
}
ins('players', ['team','squad_no','pos','name','wiki_title','captain','dob','caps','goals','club','club_country'], playerRows);
ins('staff', ['team','role','name','wiki_title','nationality_code'], staffRows);

ins('org_people', ['org','name','role','status','source_url','wikipedia_title','notes'],
  [...fifa.people.map((p) => ['FIFA', p.name, p.role, p.status, p.source_url, p.wikipedia_title || null, p.notes ?? null]),
   ...ussf.people.map((p) => ['USSF', p.name, p.role, p.status, p.source_url, p.wikipedia_title || null, p.notes ?? null])]);

ins('images', ['subject_type','subject_name','team','qid','status','commons_file','file_page','author','license','license_url','local_file','rejected_license'],
  images.map((e) => [e.subject_type, e.name, e.team, e.qid ?? null, e.status,
    e.image?.commons_file ?? null, e.image?.file_page ?? e.rejected_file_page ?? null,
    e.image?.author ?? null, e.image?.license ?? null, e.image?.license_url ?? null,
    e.qid && manifest[e.qid] ? manifest[e.qid].file : null, e.rejected_license ?? null]));

ins('discrepancies', ['id','entity_type','entity_id','field','value_a','value_b','severity','status','resolution','source_a','source_b','created_at'],
  [...disc.resolved.map((d) => [`match-${d.match_no}-kickoff`, 'match', String(d.match_no), d.field,
      d.openfootball, d.fixturedownload, 'blocker', 'resolved', `${d.rule}: ${d.note}`, d.tiebreaker_url, null, new Date().toISOString()]),
   ...disc.open.map((d) => [d.id, 'aggregate', null, d.field, d.value_a, d.value_b, d.severity, 'open', d.resolution, d.source_a, d.source_b, new Date().toISOString()])]);

lines.push(`INSERT INTO ingest_runs (source_id, job, started_at, finished_at, ok, stats_json) VALUES (NULL, 'seed-d1', datetime('now'), datetime('now'), 1, '${JSON.stringify({ matches: matches.length, teams: teams.length, players: totalPlayers, broadcasts: broadcasts.length }).replace(/'/g, "''")}');`);

writeFileSync('/tmp/g26-seed.sql', lines.join('\n') + '\n');
console.log(`seed SQL written: ${lines.length} statements — matches=104 teams=48 players=${totalPlayers} broadcasts=104 org_people=${fifa.people.length + ussf.people.length} images=${images.length}`);
