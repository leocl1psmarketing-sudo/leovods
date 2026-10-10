const $ = (id) => document.getElementById(id);
const yUrl = $('yUrl'), yFetch = $('yFetch');
let yInfo = null, yQuality = '720p', yFormat = 'mp4';

function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }
function showErr(m){ const e=$('yErr'); e.textContent=m; e.classList.add('show'); }
function clearErr(){ $('yErr').classList.remove('show'); }
function fmtSize(bytes){
  if(!bytes || bytes<=0) return null;
  if(bytes>=1e9) return (bytes/1e9).toFixed(1)+' GB';
  if(bytes>=1e6) return Math.round(bytes/1e6)+' MB';
  return Math.max(1,Math.round(bytes/1e3))+' KB';
}
function estBytes(){
  if(!yInfo) return null;
  if(yFormat==='mp3'){
    const base=Number(yInfo.mp3)||0;
    if(!base) return null;
    const kbps=Number($('yBitrate').value)||192;
    return Math.round(base*kbps/160); // estimate was normalized ~160k source
  }
  return Number((yInfo.mp4||{})[yQuality])||null;
}
function updateYtDl(){
  const s=fmtSize(estBytes());
  $('yDl').textContent = yFormat==='mp3'
    ? (s?`⬇ Download MP3 (~${s})`:'⬇ Download MP3')
    : (s?`⬇ Download MP4 (~${s})`:'⬇ Download MP4');
  $('yBitrate').style.display = yFormat==='mp3' ? '' : 'none';
  $('yQRow').style.display = yFormat==='mp3' ? 'none' : 'flex';
}

document.querySelectorAll('#yFmtRow .q').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#yFmtRow .q').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); yFormat=b.dataset.f; updateYtDl();
});
document.querySelectorAll('#yQRow .q[data-q]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#yQRow .q[data-q]').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); yQuality=b.dataset.q; updateYtDl();
});
$('yBitrate').onchange=updateYtDl;
document.querySelector('#yFmtRow .q[data-f="mp4"]')?.classList.add('active');
document.querySelector('#yQRow .q[data-q="720p"]')?.classList.add('active');

yFetch.onclick = async ()=>{
  const u=yUrl.value.trim();
  if(!u || !/youtube\.com|youtu\.be/i.test(u)){ showErr('Paste a youtube.com or youtu.be link first.'); return; }
  clearErr(); $('yRes').classList.remove('show');
  $('yFmtRow').style.display='none'; $('yQRow').style.display='none';
  $('ySpin').classList.add('show'); yFetch.disabled=true;
  try{
    const r=await fetch('/api/yt/info?url='+encodeURIComponent(u));
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||'Fetch failed');
    yInfo=j;
    $('yTitle').textContent=j.title;
    $('yThumb').src=j.thumbnail||'';
    $('yMeta').textContent=`${j.author||''} • ${j.duration||'?'} • ${Number(j.views||0).toLocaleString()} views`;
    $('yFmtRow').style.display='flex';
    $('yRes').classList.add('show');
    updateYtDl();
  }catch(e){ showErr(e.message); }
  finally{ $('ySpin').classList.remove('show'); yFetch.disabled=false; }
};

$('yDl').onclick = ()=>{
  if(!yInfo) return;
  const q=`/api/yt/download?url=${encodeURIComponent(yUrl.value.trim())}&format=${yFormat}&quality=${yQuality}&bitrate=${$('yBitrate').value}`;
  window.location.href=q;
  toast(yFormat==='mp3' ? 'MP3 conversion started — keep the tab open…' : 'MP4 download started…');
};
$('yOpen').onclick = ()=>{ if(yInfo?.webpageUrl) window.open(yInfo.webpageUrl,'_blank'); };
yUrl.addEventListener('keydown',e=>{ if(e.key==='Enter') yFetch.click(); });
