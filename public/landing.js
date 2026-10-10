const $ = (id) => document.getElementById(id);
const url = $('url'), fetchBtn = $('fetchBtn'), spin = $('spin'), err = $('err'),
  result = $('result'), qRow = $('qRow');
let current = null, quality = 'best';

function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }
function showErr(m){ err.textContent=m; err.classList.add('show'); }
function clearErr(){ err.classList.remove('show'); }

function fmtSize(bytes){
  if(!bytes || bytes<=0) return null;
  if(bytes>=1e9) return (bytes/1e9).toFixed(1)+' GB';
  if(bytes>=1e6) return Math.round(bytes/1e6)+' MB';
  return Math.max(1,Math.round(bytes/1e3))+' KB';
}
// Estimated bytes = bitrate × duration (VBR streams vary, hence "~").
function matchFormat(q){
  const list=current?.formats||[];
  if(!list.length) return null;
  const s=String(q||'best').toLowerCase();
  if(s==='best'||s==='source') return list.reduce((a,b)=>((b.tbr||0)>(a.tbr||0)?b:a),list[0]);
  let f=list.find(x=>String(x.id).toLowerCase()===s||String(x.folder||'').toLowerCase()===s);
  if(f) return f;
  const h=(s.match(/(\d{3,4})/)||[])[1];
  if(h){ const hh=list.filter(x=>x.height===Number(h)); if(hh.length) return hh[hh.length-1]; }
  return null;
}
function updateDlLabels(){
  if(!current){ $('dlMp4').textContent='⬇ MP4'; $('dlMp3').textContent='♫ MP3'; return; }
  const dur=Number(current.durationSec)||0;
  const f=matchFormat(quality);
  const vBytes=(f?.tbr&&dur)? f.tbr*1000/8*dur : null;
  const aBytes=dur? 192*1000/8*dur : null;
  const vs=fmtSize(vBytes), as=fmtSize(aBytes);
  $('dlMp4').textContent=vs?`⬇ MP4 (~${vs})`:'⬇ MP4';
  $('dlMp3').textContent=as?`♫ MP3 (~${as})`:'♫ MP3';
}

document.querySelectorAll('.q').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.q').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); quality=b.dataset.q; updateDlLabels();
});
document.querySelector('.q[data-q="best"]')?.classList.add('active');

fetchBtn.onclick = async ()=>{
  const u = url.value.trim();
  if(!u || !/kick\.com/i.test(u)){ showErr('Paste a kick.com VOD or clip link first.'); return; }
  clearErr(); result.classList.remove('show'); qRow.style.display='none';
  spin.classList.add('show'); fetchBtn.disabled=true;
  try{
    const r = await fetch('/api/vod-info?url='+encodeURIComponent(u));
    const j = await r.json();
    if(!r.ok) throw new Error(j.error||'Fetch failed');
    current=j;
    $('rTitle').textContent=j.title;
    $('rThumb').src=j.thumbnail||'';
    $('rChan').textContent='@'+(j.channel||'?');
    $('rDur').textContent='⏱ '+(j.duration||'?');
    $('rViews').textContent='👁 '+(Number(j.views||0).toLocaleString())+' views'+(j.mature?' • 🔞 18+':'');
    if(j.expiresAt){ $('rDur').textContent+=' • ⏳ until '+new Date(j.expiresAt).toLocaleDateString(); }
    result.classList.add('show'); qRow.style.display='flex';
    // highlight available qualities
    const avail = new Set((j.formats||[]).map(f=>f.id));
    document.querySelectorAll('.q').forEach(b=>{
      if(b.dataset.q==='best'){b.disabled=false;return;}
      b.disabled = avail.size && !avail.has(b.dataset.q);
      b.style.opacity = b.disabled? .35:1;
    });
    quality='best';
    document.querySelectorAll('.q').forEach(x=>x.classList.remove('active'));
    document.querySelector('.q[data-q="best"]')?.classList.add('active');
    updateDlLabels();
  }catch(e){ showErr(e.message); }
  finally{ spin.classList.remove('show'); fetchBtn.disabled=false; }
};

$('dlMp4').onclick = ()=>{
  if(!current) return;
  window.location.href = '/api/download?url='+encodeURIComponent($('url').value.trim())+'&quality='+encodeURIComponent(quality)+'&format=mp4';
  toast('MP4 download started…');
};
$('dlMp3').onclick = ()=>{
  if(!current) return;
  window.location.href = '/api/download?url='+encodeURIComponent($('url').value.trim())+'&quality='+encodeURIComponent(quality)+'&format=mp3';
  toast('MP3 conversion started — keep the tab open…');
};
$('copyM3u8').onclick = async ()=>{
  if(!current) return;
  try{
    const r = await fetch('/api/stream-url?url='+encodeURIComponent($('url').value.trim())+'&quality='+encodeURIComponent(quality==='best'?'1080p60':quality));
    const j = await r.json();
    if(!r.ok) throw new Error(j.error);
    await navigator.clipboard.writeText((j.urls||[]).join('\n'));
    toast('m3u8 link copied ✓');
  }catch(e){ showErr(e.message); }
};
$('openKick').onclick = ()=>{ if(current?.webpageUrl) window.open(current.webpageUrl,'_blank'); };
url.addEventListener('keydown',e=>{ if(e.key==='Enter') fetchBtn.click(); });
