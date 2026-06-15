// Golazo 26 — match predictions. Loads ONLY on match pages that carry a
// #predict-box (baked when data/clerk-public.json exists at build time).
// Auth: Clerk (email magic link/code). Predictions lock at kickoff, editable
// until then. API: golazo26-api worker; the identity mirror keeps accounts
// vendor-portable. No tracking — Clerk loads only when this box renders.
(() => {
  const box = document.getElementById('predict-box');
  if (!box) return;
  const API = 'https://golazo26-api.onwike.workers.dev';
  const pk = box.dataset.pk;
  const matchNo = Number(box.dataset.match);
  const kickoff = Date.parse(box.dataset.kickoff);
  const el = (html) => { box.innerHTML = html; };
  // SECURITY: escape any user-derived value (e.g. the viewer's Clerk email) before it
  // enters the innerHTML template, closing the self-XSS reflection.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  if (Date.now() >= kickoff) { el('<p class="muted">Predictions for this match are locked (kicked off).</p>'); return; }

  // Clerk frontend host is encoded in the publishable key
  let host;
  try { host = atob(pk.split('_')[2]).replace(/\$$/, ''); } catch { el('<p class="muted">Predictions unavailable.</p>'); return; }

  el('<p class="muted">Loading predictions…</p>');
  const s = document.createElement('script');
  s.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  s.crossOrigin = 'anonymous';
  s.setAttribute('data-clerk-publishable-key', pk);
  s.onload = init;
  s.onerror = () => el('<p class="muted">Predictions unavailable right now.</p>');
  document.head.appendChild(s);

  async function init() {
    try { await window.Clerk.load(); } catch { el('<p class="muted">Sign-in service unavailable.</p>'); return; }
    render();
    window.Clerk.addListener(() => render());
  }

  async function render() {
    const user = window.Clerk.user;
    if (!user) {
      el('<button class="btn" id="predict-signin">Sign in with email to predict</button><p class="muted">Free; your email is only used for your account. One prediction per match, editable until kickoff.</p>');
      document.getElementById('predict-signin').onclick = () => window.Clerk.openSignIn({});
      return;
    }
    const token = await window.Clerk.session.getToken();
    let mine = null;
    try {
      const res = await fetch(`${API}/predictions/mine`, { headers: { Authorization: `Bearer ${token}` } });
      mine = (await res.json()).predictions?.find((p) => p.match_no === matchNo) ?? null;
    } catch {}
    el(`
      <div class="predict-form">
        <label>Your score prediction:</label>
        <input id="p-home" type="number" min="0" max="20" inputmode="numeric" value="${mine ? mine.home : ''}" aria-label="home goals"> :
        <input id="p-away" type="number" min="0" max="20" inputmode="numeric" value="${mine ? mine.away : ''}" aria-label="away goals">
        <button class="btn" id="p-save">${mine ? 'Update' : 'Save'}</button>
        <span id="p-msg" class="muted">${mine ? `saved ${mine.updated_at} UTC` : ''}</span>
      </div>
      <p class="muted">Signed in as ${esc(user.primaryEmailAddress?.emailAddress ?? 'you')} · <a href="#" id="p-signout">sign out</a> · editable until kickoff · scored 3 pts exact / 1 pt outcome</p>`);
    document.getElementById('p-signout').onclick = (e) => { e.preventDefault(); window.Clerk.signOut(); };
    document.getElementById('p-save').onclick = async () => {
      const home = Number(document.getElementById('p-home').value);
      const away = Number(document.getElementById('p-away').value);
      const msg = document.getElementById('p-msg');
      if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) { msg.textContent = 'enter both scores'; return; }
      msg.textContent = 'saving…';
      try {
        const t = await window.Clerk.session.getToken();
        const res = await fetch(`${API}/predictions`, {
          method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ match_no: matchNo, home, away }),
        });
        const out = await res.json();
        msg.textContent = res.ok ? `saved ✓ (${out.home} : ${out.away})` : (out.error ?? 'failed');
      } catch { msg.textContent = 'network error — try again'; }
    };
  }
})();
