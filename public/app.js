const $ = (id) => document.getElementById(id);
function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }
function errShow(id,msg){ const e=$(id); if(!msg){e.classList.remove('show');return;} e.textContent=msg; e.classList.add('show'); }

// tabs (support #hash deep links from landing page)
const btns=[...document.querySelectorAll('.tab-btn')];
function showTab(name){
  btns.forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='p-'+name));
  if(location.hash!=='#'+name) history.replaceState(null,'','#'+name);
}
btns.forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
if(location.hash){ const h=location.hash.slice(1); if(document.getElementById('p-'+h)) showTab(h); }
addEventListener('hashchange',()=>{ const h=location.hash.slice(1); if(document.getElementById('p-'+h)) showTab(h); });

// server status
fetch('/api/health').then(r=>r.json()).then(j=>{ $('apiStatus').textContent='● server online — engine: '+(j.engine||'ok'); $('apiStatus').style.color='var(--blue)'; })
.catch(()=>{ $('apiStatus').textContent='● server offline — start it with: npm start'; $('apiStatus').style.color='#ff8080'; });

// ---- VOD ----
let vodUrl='', vodInfo=null;
function fmtSize(bytes){
  if(!bytes || bytes<=0) return null;
  if(bytes>=1e9) return (bytes/1e9).toFixed(1)+' GB';
  if(bytes>=1e6) return Math.round(bytes/1e6)+' MB';
  return Math.max(1,Math.round(bytes/1e3))+' KB';
}
function updateAppDlLabels(){
  const q=($('vQ')||{}).value||'best';
  const dur=Number(vodInfo?.durationSec)||0;
  const list=vodInfo?.formats||[];
  let f=null;
  if(list.length){
    if(q==='best') f=list.reduce((a,b)=>((b.tbr||0)>(a.tbr||0)?b:a),list[0]);
    else f=list.find(x=>String(x.id).toLowerCase()===q||String(x.folder||'').toLowerCase()===q)
      ||list.find(x=>x.height===Number((q.match(/(\d{3,4})/)||[])[1]));
  }
  const vs=(f?.tbr&&dur)?fmtSize(f.tbr*1000/8*dur):null;
  const as=dur?fmtSize(192*1000/8*dur):null;
  $('vMp4').textContent=vs?`⬇ MP4 (~${vs})`:'⬇ MP4';
  $('vMp3').textContent=as?`♫ MP3 (~${as})`:'♫ MP3';
}
$('vQ').onchange=updateAppDlLabels;
$('vFetch').onclick=async()=>{
  const u=$('vUrl').value.trim();
  if(!/kick\.com/i.test(u)){ errShow('vErr','Paste a kick.com VOD link.'); return; }
  errShow('vErr',''); $('vRes').classList.remove('show');
  $('vFetch').disabled=true; $('vFetch').textContent='Fetching…';
  try{
    const r=await fetch('/api/vod-info?url='+encodeURIComponent(u));
    const j=await r.json(); if(!r.ok) throw new Error(j.error);
    vodUrl=u;
    vodInfo=j;
    $('vTitle').textContent=j.title;
    $('vThumb').src=j.thumbnail||'';
    $('vMeta').textContent=`@${j.channel} • ${j.duration} • ${Number(j.views||0).toLocaleString()} views${j.mature?' • 🔞 18+':''}${j.expiresAt?' • ⏳ until '+new Date(j.expiresAt).toLocaleDateString():''}`;
    const box=$('vFormats'); box.innerHTML='';
    const dur=Number(j.durationSec)||0;
    (j.formats||[]).forEach(f=>{
      const s=(f.tbr&&dur)?fmtSize(f.tbr*1000/8*dur):null;
      const b=document.createElement('button'); b.className='btn btn-sm'; b.textContent=s?`⬇ ${f.id} · ~${s}`:'⬇ '+f.id;
      b.onclick=()=>{ window.location.href='/api/download?url='+encodeURIComponent(u)+'&quality='+encodeURIComponent(f.id)+'&format=mp4'; toast('Downloading '+f.id+(s?` (~${s})`:'')+'…'); };
      box.appendChild(b);
    });
    if(!(j.formats||[]).length){ const s=document.createElement('span'); s.className='muted'; s.textContent='No quality list — use Best below.'; box.appendChild(s); }
    updateAppDlLabels();
    $('vRes').classList.add('show');
  }catch(e){ errShow('vErr',e.message); }
  finally{ $('vFetch').disabled=false; $('vFetch').textContent='Fetch info'; }
};
function dlV(format){ const u=$('vUrl').value.trim()||vodUrl; if(!/kick\.com/i.test(u)){errShow('vErr','Paste a VOD link first.');return;} window.location.href=`/api/download?url=${encodeURIComponent(u)}&quality=${encodeURIComponent($('vQ').value)}&format=${format}`; toast(format.toUpperCase()+' started…'); }
$('vMp4').onclick=()=>dlV('mp4'); $('vMp3').onclick=()=>dlV('mp3');
$('vCopy').onclick=async()=>{ const u=$('vUrl').value.trim(); if(!u) return;
  const r=await fetch('/api/stream-url?url='+encodeURIComponent(u)+'&quality='+encodeURIComponent($('vQ').value==='best'?'1080p60':$('vQ').value));
  const j=await r.json(); if(!r.ok){ errShow('vErr',j.error); return; }
  await navigator.clipboard.writeText(j.urls.join('\n')); toast('m3u8 copied ✓'); };

// ---- CHANNEL ----
$('cGo').onclick=async()=>{
  const s=$('cSlug').value.trim().replace(/^@/,'');
  if(!s){ errShow('cErr','Enter a channel name.'); return; }
  errShow('cErr',''); $('cRes').classList.remove('show'); $('cGo').disabled=true;
  try{
    const r=await fetch('/api/channel?slug='+encodeURIComponent(s));
    const j=await r.json(); if(!r.ok) throw new Error(j.error);
    $('cAvatar').src=j.avatar||''; $('cName').textContent=(j.verified?'✔ ':'')+j.name+' (@'+j.slug+')';
    $('cMeta').textContent=`${Number(j.followers||0).toLocaleString()} followers • ${j.vods.length} recent VODs`;
    $('cLive').innerHTML=j.isLive?`🔴 LIVE — ${j.live.title||''} (${Number(j.live.viewers||0).toLocaleString()} watching)`:'⚫ offline';
    const grid=$('cVods'); grid.innerHTML='';
    j.vods.forEach(v=>{
      const d=document.createElement('div'); d.className='vod';
      d.innerHTML=`${v.thumbnail?`<img src="${v.thumbnail}" loading="lazy">`:''}<div class="vod-body"><b></b><span></span><div style="margin-top:8px;display:flex;gap:6px"></div></div>`;
      d.querySelector('b').textContent=v.title; d.querySelector('span').textContent=`${v.duration} • ${Number(v.views||0).toLocaleString()} views`;
      const row=d.querySelector('div div');
      if(v.url){ const b=document.createElement('button'); b.className='btn btn-sm btn-primary'; b.textContent='⬇'; b.onclick=()=>{ window.location.href='/api/download?url='+encodeURIComponent(v.url)+'&quality=best&format=mp4'; }; row.appendChild(b);
        const c=document.createElement('button'); c.className='btn btn-sm btn-ghost'; c.textContent='Copy link'; c.onclick=async()=>{ await navigator.clipboard.writeText(v.url); toast('VOD link copied'); }; row.appendChild(c); }
      grid.appendChild(d);
    });
    $('cRes').classList.add('show');
  }catch(e){ errShow('cErr',e.message); }
  finally{ $('cGo').disabled=false; }
};

// ---- LIVE ----
$('lGo').onclick=async()=>{
  const s=$('lSlug').value.trim().replace(/^@/,'');
  if(!s){ errShow('lErr','Enter a channel name.'); return; }
  errShow('lErr','');
  try{
    const r=await fetch('/api/channel?slug='+encodeURIComponent(s));
    const j=await r.json(); if(!r.ok) throw new Error(j.error);
    $('lRes').classList.add('show');
    if(j.isLive){ $('lTitle').textContent='🔴 '+j.name+' is LIVE — '+(j.live.title||''); $('lMeta').textContent=`${Number(j.live.viewers||0).toLocaleString()} viewers • started ${j.live.startedAt||'recently'}`; $('lWatch').href='https://kick.com/'+j.slug; }
    else{ $('lTitle').textContent='⚫ '+j.name+' is offline'; $('lMeta').textContent=`${Number(j.followers||0).toLocaleString()} followers • last VODs available in Channel Explorer`; $('lWatch').href='https://kick.com/'+j.slug; }
  }catch(e){ errShow('lErr',e.message); }
};

// ---- CLIPS ----
$('clFetch').onclick=async()=>{
  const u=$('clUrl').value.trim();
  if(!/kick\.com/i.test(u)){ errShow('clErr','Paste a kick.com clip link.'); return; }
  errShow('clErr','');
  try{
    const r=await fetch('/api/clip-info?url='+encodeURIComponent(u)); const j=await r.json(); if(!r.ok) throw new Error(j.error);
    $('clTitle').textContent=j.title; $('clThumb').src=j.thumbnail||''; $('clMeta').textContent=`${j.duration} • ${Number(j.views||0).toLocaleString()} views`;
    $('clRes').classList.add('show');
    $('clMp4').onclick=()=>{ window.location.href='/api/download?url='+encodeURIComponent(u)+'&quality=best&format=mp4'; };
    $('clMp3').onclick=()=>{ window.location.href='/api/download?url='+encodeURIComponent(u)+'&quality=best&format=mp3'; };
  }catch(e){ errShow('clErr',e.message); }
};

// ---- TRIM ----
$('tMp4').onclick=()=>trimDl('mp4'); $('tMp3').onclick=()=>trimDl('mp3');
function trimDl(fmt){ const u=$('tUrl').value.trim(); if(!/kick\.com/i.test(u)){ toast('Paste a VOD link first'); return; }
  window.location.href=`/api/download?url=${encodeURIComponent(u)}&quality=${encodeURIComponent($('tQ').value)}&format=${fmt}&start=${encodeURIComponent($('tStart').value)}&end=${encodeURIComponent($('tEnd').value)}`;
  toast('Trimmed '+fmt.toUpperCase()+' started…'); }

// ---- M3U8 ----
$('mGo').onclick=async()=>{
  const u=$('mUrl').value.trim(); if(!/kick\.com/i.test(u)){ errShow('mErr','Paste a Kick URL.'); return; }
  errShow('mErr',''); $('mOut').value='resolving…';
  try{
    const r=await fetch('/api/stream-url?url='+encodeURIComponent(u)+'&quality='+encodeURIComponent($('mQ').value));
    const j=await r.json(); if(!r.ok) throw new Error(j.error);
    $('mOut').value=j.urls.join('\n');
  }catch(e){ errShow('mErr',e.message); $('mOut').value=''; }
};
$('mCopy').onclick=async()=>{ await navigator.clipboard.writeText($('mOut').value); toast('Copied ✓'); };

// ---- TTS (browser speechSynthesis — fully offline/free) ----
let voices=[];
function loadVoices(){ voices=speechSynthesis.getVoices(); const sel=$('ttsVoice'); sel.innerHTML=''; voices.forEach((v,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o); }); }
speechSynthesis.onvoiceschanged=loadVoices; loadVoices();
$('ttsPlay').onclick=()=>{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance($('ttsText').value.slice(0,500)); const v=voices[Number($('ttsVoice').value)||0]; if(v) u.voice=v; u.rate=Number($('ttsRate').value); u.pitch=Number($('ttsPitch').value); speechSynthesis.speak(u); };
$('ttsStop').onclick=()=>speechSynthesis.cancel();

// ---- COMMANDS (localStorage) ----
let cmds=[];
try{ cmds=JSON.parse(localStorage.getItem('leovods_cmds')||'[]'); }catch{ cmds=[]; }
function renderCmds(){ const tb=$('cmdRows'); tb.innerHTML=''; cmds.forEach((c,i)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td><b></b></td><td></td><td></td>`; tr.children[0].querySelector('b').textContent=c.name; tr.children[1].textContent=c.resp; const del=document.createElement('button'); del.className='btn btn-sm btn-ghost'; del.textContent='Delete'; del.onclick=()=>{ cmds.splice(i,1); saveCmds(); }; tr.children[2].appendChild(del); tb.appendChild(tr); }); }
function saveCmds(){ localStorage.setItem('leovods_cmds',JSON.stringify(cmds)); renderCmds(); }
$('cmdAdd').onclick=()=>{ const n=$('cmdName').value.trim(), r=$('cmdResp').value.trim(); if(!n.startsWith('!')||!r){ toast('Use !command + response'); return; } cmds.push({name:n,resp:r}); $('cmdName').value=''; $('cmdResp').value=''; saveCmds(); toast('Command saved ✓'); };
$('cmdExport').onclick=async()=>{ await navigator.clipboard.writeText(JSON.stringify(cmds,null,2)); toast('JSON copied ✓'); };
renderCmds();

// ---- ALERTS + CHAT ----
const NAMES=['juicer_99','kickfan','train_fan','adin_army','moist_fan','gta_rp','clip_goblin','nightowl'];
const MSGS=['W STREAM','that clutch was insane','LFG!!','first time here, love this','clip it!!','GGs','this VOD is about to be huge','mod check?','song name?','W'];
$('alFire').onclick=()=>{
  const t=$('alType').value, u=$('alUser').value||'someone';
  const prev=$('alPrev'); const labels={follow:`followed!`,sub:`subscribed!`,tip:`tipped $5!`,raid:`raided with 128 viewers!`};
  prev.innerHTML=`<div class="alert-pop">🎉 ${u} ${labels[t]}</div>`;
  if('speechSynthesis' in window){ const s=new SpeechSynthesisUtterance(`${u} ${labels[t]}`); speechSynthesis.speak(s); }
};
$('alChat').onclick=()=>{
  const box=$('chatBox'); if(box.querySelector('.muted')) box.innerHTML='';
  for(let i=0;i<4;i++){ const d=document.createElement('div'); const n=NAMES[Math.floor(Math.random()*NAMES.length)], m=MSGS[Math.floor(Math.random()*MSGS.length)];
    d.innerHTML=`<b style="color:var(--blue)"></b>: <span></span>`; d.querySelector('b').textContent=n; d.querySelector('span').textContent=m; box.appendChild(d); }
  box.scrollTop=box.scrollHeight;
};
