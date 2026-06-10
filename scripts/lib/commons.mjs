// commons.mjs — shared constants for the image-harvest + license scripts.
//
// SINGLE SOURCE OF TRUTH for the license allowlist. Every free-image ingest path
// (find-photo-candidates, build-images, harvest-gallery) MUST gate on this exact
// ALLOW — the regex previously lived copy-pasted in three files, where any drift
// would silently admit non-free images. Keep the policy here and import it.
//
// Allowed: Public Domain / PD / no-restrictions / CC0 / CC BY (but NOT NC or ND)
// / CC BY-SA / bare "attribution". Anything else — NC, ND, and free-but-unlisted
// licenses (e.g. GFDL-1.2-only) — fails the gate and quarantines for human review.
export const ALLOW = /^(public domain|pd\b|no restrictions|cc0|cc[ -]by(?![ -]?(nc|nd))|cc[ -]by[ -]sa|attribution)/i;
