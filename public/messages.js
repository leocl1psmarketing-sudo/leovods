// LeoVODS — Kick Message Generator
// Build fake Kick chat messages: username + color + badges + text, then save,
// copy, or export a clean PNG. Saved comments persist in localStorage.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const BADGES = [
    { id: 'broadcaster', emoji: '🎥', name: 'Broadcaster', color: '#ff4d4d' },
    { id: 'moderator', emoji: '🗡️', name: 'Moderator', color: '#3da13d' },
    { id: 'vip', emoji: '💎', name: 'VIP', color: '#e85bb4' },
    { id: 'sub', emoji: '⭐', name: 'Subscriber', color: '#53fc18' },
    { id: 'founder', emoji: '👑', name: 'Founder', color: '#f0b132' },
    { id: 'og', emoji: '⚡', name: 'OG', color: '#22d3ee' },
    { id: 'verified', emoji: '✅', name: 'Verified', color: '#2e9bff' },
    { id: 'gifter', emoji: '🎁', name: 'Gift sub', color: '#9b59b6' }
  ];

  const COLORS = [
    '#53fc18', '#8ce03c', '#2ecc71', '#1abc9c', '#3db5c7', '#2e9bff', '#5865f2',
    '#9b59b6', '#b26ae6', '#e85bb4', '#ff6b6b', '#ff4d4d', '#ff8c42', '#f1c40f',
    '#e67e22', '#b0b3b8', '#ffffff'
  ];

  const NAMES = ['juicer_99', 'train_fan', 'adin_army', 'clip_goblin', 'nightowl', 'kickfan22', 'gta_rp_lord', 'moist_fan', 'not_xqc', 'sub_gifter'];

  const state = {
    username: 'Viewer',
    color: COLORS[0],
    text: 'Whats your target today?',
    selected: new Set(),   // badge ids (built-in + custom)
    custom: [],            // { id, emoji, color }
    saved: []
  };

  function toast(m) {
    const t = $('toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- persistence ----
  try { state.saved = JSON.parse(localStorage.getItem('leovods_msgs') || '[]') || []; } catch { state.saved = []; }
  function persist() { try { localStorage.setItem('leovods_msgs', JSON.stringify(state.saved)); } catch {} }

  // ---- emblems ----
  function selectedBadges() {
    const out = [];
    for (const b of BADGES) if (state.selected.has(b.id)) out.push(b);
    for (const c of state.custom) if (state.selected.has(c.id)) out.push(c);
    return out;
  }

  function renderBadgePicker() {
    const box = $('badgePicker'); box.innerHTML = '';
    for (const b of BADGES) {
      const btn = document.createElement('button');
      btn.className = 'badge-btn' + (state.selected.has(b.id) ? ' active' : '');
      btn.style.setProperty('--c', b.color);
      btn.innerHTML = '<span class="bg-ico">' + b.emoji + '</span>' + esc(b.name);
      btn.onclick = () => {
        if (state.selected.has(b.id)) state.selected.delete(b.id); else state.selected.add(b.id);
        renderBadgePicker(); updatePreview();
      };
      box.appendChild(btn);
    }
  }

  function renderCustomBadges() {
    const box = $('customBadges'); box.innerHTML = '';
    for (const c of state.custom) {
      const wrap = document.createElement('span');
      wrap.style.display = 'inline-flex';
      const btn = document.createElement('button');
      btn.className = 'badge-btn' + (state.selected.has(c.id) ? ' active' : '');
      btn.style.setProperty('--c', c.color);
      btn.innerHTML = '<span class="bg-ico">' + esc(c.emoji) + '</span>';
      btn.title = 'Toggle emblem';
      btn.onclick = () => {
        if (state.selected.has(c.id)) state.selected.delete(c.id); else state.selected.add(c.id);
        renderCustomBadges(); updatePreview();
      };
      const rm = document.createElement('button');
      rm.className = 'badge-btn';
      rm.textContent = '×';
      rm.title = 'Remove';
      rm.style.padding = '5px 8px';
      rm.onclick = () => {
        state.custom = state.custom.filter((x) => x.id !== c.id);
        state.selected.delete(c.id);
        renderCustomBadges(); updatePreview();
      };
      wrap.appendChild(btn); wrap.appendChild(rm);
      box.appendChild(wrap);
    }
  }

  $('addCustomBadge').onclick = () => {
    const v = prompt('Type an emoji to use as an emblem:', '😎');
    if (!v) return;
    const emoji = Array.from(v.trim()).slice(0, 2).join('') || '❓';
    const c = { id: 'c' + Date.now(), emoji, color: '#8ea1ba' };
    state.custom.push(c); state.selected.add(c.id);
    renderCustomBadges(); updatePreview();
  };

  // ---- colors ----
  function renderColorPicker() {
    const box = $('colorPicker'); box.innerHTML = '';
    for (const col of COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (col.toLowerCase() === state.color.toLowerCase() ? ' active' : '');
      b.style.background = col;
      b.title = col;
      b.onclick = () => setColor(col);
      box.appendChild(b);
    }
  }
  function setColor(col) {
    state.color = col;
    if (/^#[0-9a-f]{6}$/i.test(col)) $('customColor').value = col;
    $('hexColor').value = col;
    renderColorPicker(); updatePreview();
  }
  $('customColor').oninput = (e) => setColor(e.target.value);
  $('hexColor').oninput = (e) => {
    const v = e.target.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v);
  };

  // ---- compose + preview ----
  function badgeMarkup(badges) {
    return (badges || selectedBadges()).map((b) => '<span class="kbadge" style="--c:' + b.color + '">' + esc(b.emoji) + '</span>').join('');
  }
  function updatePreview() {
    $('pBadges').innerHTML = badgeMarkup();
    const u = $('pUser'); u.textContent = state.username || 'Viewer'; u.style.color = state.color;
    $('pMsg').textContent = state.text;
  }
  $('username').oninput = (e) => { state.username = e.target.value; updatePreview(); };
  $('message').oninput = (e) => { state.text = e.target.value; updatePreview(); };

  // ---- save / copy ----
  function snapshot() {
    return {
      user: state.username || 'Viewer',
      color: state.color,
      text: state.text,
      badges: selectedBadges().map((b) => ({ emoji: b.emoji, color: b.color }))
    };
  }
  function savedMarkup(m) {
    return '<span class="kbadges">' + badgeMarkup(m.badges) + '</span><span class="kuser" style="color:' + esc(m.color) + '">' + esc(m.user) + '</span><span class="kcolon">:</span> <span class="kmsg">' + esc(m.text) + '</span>';
  }
  function renderSaved() {
    const list = $('savedList'); list.innerHTML = '';
    if (!state.saved.length) {
      const e = document.createElement('div');
      e.className = 'saved-empty'; e.id = 'savedEmpty';
      e.textContent = 'Nothing saved yet — build a message above and hit “Save comment”.';
      list.appendChild(e); return;
    }
    state.saved.forEach((m, i) => {
      const item = document.createElement('div'); item.className = 'saved-item';
      const msg = document.createElement('div'); msg.className = 'saved-msg'; msg.innerHTML = savedMarkup(m);
      const acts = document.createElement('div'); acts.className = 'saved-actions';

      const copy = document.createElement('button'); copy.className = 'btn btn-sm btn-ghost'; copy.textContent = 'Copy';
      copy.onclick = async () => { await navigator.clipboard.writeText(m.user + ': ' + m.text); toast('Copied ✓'); };

      const png = document.createElement('button'); png.className = 'btn btn-sm'; png.textContent = '⬇ PNG';
      png.onclick = () => exportPng(m);

      const load = document.createElement('button'); load.className = 'btn btn-sm btn-ghost'; load.textContent = 'Edit';
      load.onclick = () => {
        state.username = m.user; state.color = m.color; state.text = m.text;
        $('username').value = m.user; $('message').value = m.text;
        state.custom = []; state.selected = new Set();
        (m.badges || []).forEach((b, k) => {
          const match = BADGES.find((x) => x.emoji === b.emoji);
          if (match) state.selected.add(match.id);
          else { const c = { id: 'c' + Date.now() + k, emoji: b.emoji, color: b.color }; state.custom.push(c); state.selected.add(c.id); }
        });
        renderBadgePicker(); renderCustomBadges(); renderColorPicker(); updatePreview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };

      const del = document.createElement('button'); del.className = 'btn btn-sm btn-ghost'; del.textContent = 'Delete';
      del.onclick = () => { state.saved.splice(i, 1); persist(); renderSaved(); };

      acts.appendChild(copy); acts.appendChild(png); acts.appendChild(load); acts.appendChild(del);
      item.appendChild(msg); item.appendChild(acts);
      list.appendChild(item);
    });
  }

  $('saveComment').onclick = () => {
    state.saved.unshift(snapshot());
    if (state.saved.length > 100) state.saved.length = 100;
    persist(); renderSaved(); toast('Comment saved ✓');
  };
  $('copyComment').onclick = async () => {
    await navigator.clipboard.writeText((state.username || 'Viewer') + ': ' + state.text);
    toast('Copied ✓');
  };

  // ---- PNG export (canvas — pure black background, no external deps) ----
  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  function exportPng(m) {
    m = m || snapshot();
    try {
      const scale = Math.min(window.devicePixelRatio || 1, 3);
      const PAD = 28, LH = 40, BADGE = 30, GAP = 8;
      const nameFont = '800 26px Inter, system-ui, "Segoe UI", Roboto, Arial';
      const bodyFont = '500 26px Inter, system-ui, "Segoe UI", Roboto, Arial';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const badges = (m.badges || []).filter((b) => b && b.emoji);
      const W = 1000;
      const badgeW = badges.length ? badges.length * (BADGE + GAP) : 0;
      const maxRight = W - PAD;

      // ---- wrap username: message into lines (first line offset by badges) ----
      const tokens = [{ t: m.user || 'Viewer', font: nameFont, color: m.color }];
      tokens.push({ t: ':', font: nameFont, color: '#e2e8f0' });
      for (const word of String(m.text || '').split(/\s+/).filter(Boolean)) tokens.push({ t: word, font: bodyFont, color: '#e8edf5', space: true });

      const lines = [[]];
      let x = PAD + badgeW;
      for (const tok of tokens) {
        ctx.font = tok.font;
        const w = ctx.measureText(tok.t).width;
        const sw = tok.space ? ctx.measureText(' ').width : 0;
        if (lines[lines.length - 1].length && x + sw + w > maxRight) { lines.push([]); x = PAD; }
        x += sw;
        lines[lines.length - 1].push({ t: tok.t, font: tok.font, color: tok.color, x });
        x += w;
      }

      const H = PAD * 2 + LH + (lines.length - 1) * LH;
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      ctx.scale(scale, scale);

      // ---- pure black background ----
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // ---- badges on the first line ----
      if (badges.length) {
        let bx = PAD; const by = PAD + (LH - BADGE) / 2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const b of badges) {
          roundRect(ctx, bx, by, BADGE, BADGE, 6);
          ctx.fillStyle = '#161a22'; ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = b.color || '#8ea1ba'; ctx.stroke();
          ctx.font = '17px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
          ctx.fillStyle = '#fff';
          ctx.fillText(b.emoji, bx + BADGE / 2, by + BADGE / 2 + 1);
          bx += BADGE + GAP;
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }

      // ---- text ----
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      lines.forEach((line, li) => {
        const y = PAD + li * LH + LH * 0.7;
        for (const seg of line) {
          ctx.font = seg.font;
          ctx.fillStyle = seg.color;
          ctx.fillText(seg.t, seg.x, y);
        }
      });

      const a = document.createElement('a');
      a.download = (m.user || 'kick') + '-message.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      toast('PNG downloaded ✓');
    } catch (e) {
      toast('Could not export PNG');
    }
  }
  $('dlPng').onclick = () => exportPng();

  // ---- misc actions ----
  $('shuffleName').onclick = () => {
    const n = NAMES[Math.floor(Math.random() * NAMES.length)];
    state.username = n; $('username').value = n;
    setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
    updatePreview();
  };
  $('clearAll').onclick = () => {
    state.username = ''; state.text = ''; state.selected = new Set();
    $('username').value = ''; $('message').value = '';
    renderBadgePicker(); updatePreview();
  };

  let chatTimer = null;
  $('playChat').onclick = () => {
    const chat = $('previewChat');
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; chat.classList.remove('live'); $('playChat').textContent = '▶ Preview as live chat'; updatePreview(); return; }
    if (!state.saved.length) { toast('Save some comments first'); return; }
    chat.classList.add('live'); chat.innerHTML = ''; $('playChat').textContent = '■ Stop';
    const feed = state.saved.slice(0, 12);
    let i = 0;
    const tick = () => {
      const mm = feed[i % feed.length];
      const line = document.createElement('div'); line.className = 'kick-line';
      line.innerHTML = savedMarkup(mm);
      chat.appendChild(line);
      chat.scrollTop = chat.scrollHeight;
      i++;
      if (i >= feed.length) { clearInterval(chatTimer); chatTimer = null; $('playChat').textContent = '▶ Preview as live chat'; }
    };
    tick(); chatTimer = setInterval(tick, 650);
  };

  // ---- boot ----
  renderBadgePicker(); renderCustomBadges(); renderColorPicker(); renderSaved();
  $('username').value = state.username; $('message').value = state.text;
  setColor(state.color); updatePreview();
})();
