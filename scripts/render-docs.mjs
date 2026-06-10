#!/usr/bin/env node
// render-docs.mjs — renders the human-readable reference documents
// from the datasets in data/. Single source of truth: the JSON.
// Zero dependencies. Re-run whenever a dataset changes.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const matches = load('data/matches.json');
const venues = load('data/venues.json');
const teams = load('data/teams.json');
const rosters = load('data/rosters.json');
const discrepancies = load('data/discrepancies.json');
const images = existsSync('data/images.json') ? load('data/images.json') : null;
const broadcasts = existsSync('data/broadcasts.json') ? load('data/broadcasts.json') : null;

const venueById = new Map(venues.venues.map((v) => [v.id, v]));
const teamByName = new Map(teams.teams.map((t) => [t.name, t]));
const bcastByMatch = new Map((broadcasts?.rows ?? []).map((r) => [r.n, r]));

const fmt = (iso, tz, opts = {}) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', ...opts }).format(new Date(iso));
const fmtDateET = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

const sideName = (s) => (s.team ? `${teamByName.get(s.team)?.flag ?? ''} ${s.team}`.trim() : `_${s.placeholder_text}_`);
const stageLabel = { group: 'Group', r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', third: 'Third place', final: 'Final' };

// ---------- docs/game-calendar.md ----------
{
  const byDateET = new Map();
  for (const m of matches.matches) {
    const d = fmtDateET(m.kickoff_utc);
    if (!byDateET.has(d)) byDateET.set(d, []);
    byDateET.get(d).push(m);
  }
  let md = `# Game Calendar — 2026 FIFA World Cup\n\nAll 104 matches. Times shown in US Eastern (ET) and venue-local time. `;
  md += `Generated ${matches.generated_at} from [openfootball](https://github.com/openfootball/worldcup.json) cross-checked against [fixturedownload](https://fixturedownload.com/feed/json/fifa-world-cup-2026); kickoff disagreements resolved 2-of-3 with Wikipedia (see [discrepancies](../data/discrepancies.json)).\n\n`;
  md += broadcasts
    ? `US TV columns from published schedules — every row carries its own source in [data/broadcasts.json](../data/broadcasts.json). "TBD" = not yet published, never inferred.\n\n`
    : `> US TV assignments pending the broadcast research pass — shown as TBD.\n\n`;
  for (const [date, ms] of byDateET) {
    md += `## ${date}\n\n| # | ET | Match | Stage | Venue (local time) | US English | US Spanish |\n|---|---|---|---|---|---|---|\n`;
    for (const m of ms.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc) || a.match_no - b.match_no)) {
      const v = venueById.get(m.venue_id);
      const b = bcastByMatch.get(m.match_no);
      const stage = m.stage === 'group' ? `Group ${m.group}` : stageLabel[m.stage];
      md += `| ${m.match_no} | ${fmt(m.kickoff_utc, 'America/New_York')} | ${sideName(m.home)} vs ${sideName(m.away)} | ${stage} | ${v.common_name}, ${v.city} (${fmt(m.kickoff_utc, v.tz)}) | ${b?.us_english ?? 'TBD'} | ${b?.us_spanish ?? 'TBD'} |\n`;
    }
    md += '\n';
  }
  md += `\n## Sources & integrity\n\n- Schedule: openfootball (public domain) ⨯ fixturedownload — joined per match, kickoffs equal or 2-of-3 resolved (${discrepancies.resolved.length} documented resolutions: matches ${discrepancies.resolved.map((d) => d.match_no).join(', ')}).\n- Venues: FIFA names from fixturedownload; common names/cities from [Wikipedia rev 1358650246](https://en.wikipedia.org/w/index.php?title=2026_FIFA_World_Cup&oldid=1358650246).\n- Knockout slots show official placeholder text until resolved upstream — never predictions.\n`;
  writeFileSync('docs/game-calendar.md', md);
}

// ---------- docs/teams.md ----------
{
  let md = `# Teams — 2026 FIFA World Cup\n\n48 teams, 12 groups. Derived from the cross-checked match data (${teams.generated_at}); coaches and captains from the pinned squads revision ([permalink](${rosters.source.permalink}), CC BY-SA 4.0).\n\n`;
  for (const g of [...new Set(teams.teams.map((t) => t.group))]) {
    md += `## Group ${g}\n\n| Team | Coach | Captain | Squad |\n|---|---|---|---|\n`;
    for (const t of teams.teams.filter((x) => x.group === g)) {
      const r = rosters.teams.find((x) => x.team === t.name);
      const cap = r?.players.find((p) => p.captain);
      md += `| ${t.flag} **${t.name}** | ${r?.coach?.name ?? 'TBD'} | ${cap?.name ?? 'TBD'} | ${r?.players.length ?? '–'} |\n`;
    }
    md += '\n';
  }
  writeFileSync('docs/teams.md', md);
}

// ---------- docs/rosters.md ----------
{
  let md = `# Team rosters & staff — 2026 FIFA World Cup\n\n${rosters.player_count} players across ${rosters.team_count} squads (46×26, Argentina & Austria 25). `;
  md += `Source: Wikipedia "${rosters.source.title}", pinned revision [${rosters.source.revid}](${rosters.source.permalink}), licensed [CC BY-SA 4.0](${rosters.source.license_url}). Text derived from that revision.\n\n`;
  md += `> **Documented discrepancy**: FIFA's official squad-lists PDF v1 still shows 26 players for Argentina and Austria (incl. Leonardo Balerdi and Christoph Baumgartner); the pinned revision reflects their corroborated injury withdrawals (25 each). Replacements may be registered until 24h before each team's first match — the roster watch re-pins and rebuilds on change. Details: [data/discrepancies.json](../data/discrepancies.json).\n\n`;
  for (const t of rosters.teams) {
    const team = teamByName.get(t.team);
    md += `## ${team?.flag ?? ''} ${t.team}\n\n**Head coach:** ${t.coach?.name ?? 'TBD'}\n\n| # | Pos | Player | DOB | Caps | Goals | Club |\n|---|---|---|---|---|---|---|\n`;
    for (const p of [...t.players].sort((a, b) => a.no - b.no)) {
      md += `| ${p.no} | ${p.pos} | ${p.name}${p.captain ? ' (c)' : ''} | ${p.dob} | ${p.caps} | ${p.goals} | ${p.club} |\n`;
    }
    md += '\n';
  }
  writeFileSync('docs/rosters.md', md);
}

// ---------- docs/pictures.md ----------
if (images) {
  const c = images.coverage;
  let md = `# Team & player pictures — coverage report\n\nPipeline: ${images.pipeline}\nLicense allowlist: ${images.license_allowlist}\nGenerated ${images.generated_at}; full per-file attribution data in [data/images.json](../data/images.json).\n\n`;
  md += `| Status | Count | Meaning |\n|---|---|---|\n`;
  const meaning = {
    ok: 'License-cleared Commons photo, QID-matched — attribution rendered on-page',
    no_image: 'Person has a Wikidata item but no P18 photo → initials avatar',
    no_wiki_article: 'No Wikipedia article (red link) → initials avatar',
    no_qid: 'Article exists but no Wikidata item → initials avatar',
    license_rejected: 'Photo exists but its license is outside the allowlist (the 3 current cases are GFDL-1.2-only — free, but not allowlisted; actual license recorded per entry) → excluded, initials avatar',
    license_unreadable: 'License metadata unreadable → excluded, initials avatar',
  };
  for (const [k, n] of Object.entries(c)) md += `| ${k} | ${n} | ${meaning[k] ?? ''} |\n`;
  md += `\nSample attribution line (as rendered on-page):\n\n`;
  const sample = images.entries.find((e) => e.status === 'ok' && e.image.author);
  if (sample) md += `> Photo of ${sample.name}: [${sample.image.commons_file}](${sample.image.file_page}) by ${sample.image.author}, [${sample.image.license}](${sample.image.license_url}), via Wikimedia Commons (cropped/resized).\n`;
  md += `\nPer-team OK coverage:\n\n| Team | Players with photo | of |\n|---|---|---|\n`;
  for (const t of rosters.teams) {
    const ok = images.entries.filter((e) => e.subject_type === 'player' && e.team === t.team && e.status === 'ok').length;
    md += `| ${t.team} | ${ok} | ${t.players.length} |\n`;
  }
  writeFileSync('docs/pictures.md', md);
}

// ---------- docs/people-fifa.md + docs/people-ussf.md ----------
for (const [file, dataFile, title] of [
  ['docs/people-fifa.md', 'data/people-fifa.json', 'FIFA Administration & Staff'],
  ['docs/people-ussf.md', 'data/people-ussf.json', 'U.S. Soccer Federation Administration & Staff'],
]) {
  if (!existsSync(dataFile)) continue;
  const d = load(dataFile);
  const imgByName = new Map((images?.entries ?? []).filter((e) => e.subject_type === 'org_person').map((e) => [e.name, e]));
  let md = `# ${title} — with pictures\n\nVerified ${d.verified_at}: ${d.verification}. Per-person sources below; photos are Wikimedia Commons, Wikidata-QID matched, license-allowlisted, with full attribution in [data/images.json](../data/images.json).\n\n`;
  md += `| | Name | Role | Photo | Source |\n|---|---|---|---|---|\n`;
  for (const p of d.people.filter((x) => x.status === 'confirmed')) {
    const img = imgByName.get(p.name);
    const photo = img?.status === 'ok'
      ? `[${img.image.license}](${img.image.file_page})`
      : 'initials avatar';
    const thumb = img?.status === 'ok' ? `<img src="${img.image.thumb_url}" width="56" alt="${p.name}">` : '—';
    md += `| ${thumb} | **${p.name}** | ${p.role} | ${photo} | [source](${p.source_url}) |\n`;
  }
  const tbd = d.people.filter((x) => x.status !== 'confirmed');
  if (tbd.length) {
    md += `\n**Honestly unresolved (rendered as TBD, never guessed):**\n`;
    for (const p of tbd) md += `- ${p.role}: ${p.notes}\n`;
  }
  if (file.includes('fifa')) md += `\n> Editorial, non-commercial fan content. No FIFA marks/emblems are used; names and roles are reported journalistically with citations.\n`;
  writeFileSync(file, md);
}

// ---------- how-to-watch appendix inside game calendar ----------
if (broadcasts) {
  const camx = existsSync('data/broadcasts-ca-mx.json') ? load('data/broadcasts-ca-mx.json') : null;
  let md = readFileSync('docs/game-calendar.md', 'utf8');
  md += `\n## US totals & free-viewing summary\n\n- **${broadcasts.totals.FOX} matches on FOX — free over the air with an antenna** (every match from the Round of 16 onward, all USMNT group games); ${broadcasts.totals.FS1} on FS1 (pay TV).\n- **${broadcasts.totals.Telemundo} matches on Telemundo — free OTA in Spanish**; ${broadcasts.totals.Universo} on Universo (pay TV). All 104 stream in Spanish on Peacock Premium.\n- ${broadcasts.totals_note}\n`;
  if (camx) {
    md += `\n## Canada & Mexico (country level)\n\n`;
    for (const c of camx.claims) {
      const note = (c.notes ?? '').slice(0, 300);
      if (note) md += `- ${note} ([source](${c.source_url}))\n`;
    }
    if (camx.verifier_corrections.length) md += `\n_${camx.verifier_corrections.length} verifier correction(s) recorded in [data/broadcasts-ca-mx.json](../data/broadcasts-ca-mx.json)._\n`;
  }
  writeFileSync('docs/game-calendar.md', md);
}

console.log('rendered:', ['docs/game-calendar.md', 'docs/teams.md', 'docs/rosters.md', images && 'docs/pictures.md', existsSync('data/people-fifa.json') && 'docs/people-fifa.md', existsSync('data/people-ussf.json') && 'docs/people-ussf.md'].filter(Boolean).join(', '));
