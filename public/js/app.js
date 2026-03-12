'use strict';

// ── Quran verses ──────────────────────────────────────────────
const VERSES=[
  {bn:'নিশ্চয়ই কষ্টের সাথে স্বস্তি আছে। নিশ্চয়ই কষ্টের সাথে স্বস্তি আছে।',ref:'সূরা আশ-শারহ ৯৪:৫-৬'},
  {bn:'যে আল্লাহর উপর ভরসা করে, আল্লাহই তার জন্য যথেষ্ট।',ref:'সূরা আত-তালাক ৬৫:৩'},
  {bn:'আল্লাহ কাউকে তার সাধ্যের বাইরে বোঝা চাপিয়ে দেন না।',ref:'সূরা আল-বাকারাহ ২:২৮৬'},
  {bn:'তোমরা আমাকে ডাকো, আমি তোমাদের ডাকে সাড়া দেব।',ref:'সূরা আল-মুমিন ৪০:৬০'},
  {bn:'তোমরা আল্লাহর রহমত থেকে নিরাশ হয়ো না।',ref:'সূরা আয-যুমার ৩৯:৫৩'},
  {bn:'নিশ্চয়ই আল্লাহ ধৈর্যশীলদের সাথে আছেন।',ref:'সূরা আল-বাকারাহ ২:১৫৩'},
  {bn:'সত্য এসেছে এবং মিথ্যা বিলুপ্ত হয়েছে।',ref:'সূরা আল-ইসরা ১৭:৮১'},
  {bn:'আল্লাহর সত্তা ছাড়া সব কিছু ধ্বংসশীল।',ref:'সূরা আল-কাসাস ২৮:৮৮'},
  {bn:'যদি আল্লাহ তোমাদের সাহায্য করেন, কেউ তোমাদের পরাজিত করতে পারবে না।',ref:'সূরা আলে-ইমরান ৩:১৬০'},
  {bn:'আল্লাহ আসমান ও যমীনের আলো।',ref:'সূরা আন-নূর ২৪:৩৫'},
  {bn:'নিশ্চয়ই আল্লাহ সুন্দরকর্মীদের সাথে আছেন।',ref:'সূরা আল-আনকাবুত ২৯:৬৯'},
  {bn:'আল্লাহর স্মরণেই অন্তর প্রশান্তি পায়।',ref:'সূরা আর-রাআদ ১৩:২৮'},
  {bn:'বলুন — তিনি আল্লাহ, এক ও অদ্বিতীয়।',ref:'সূরা আল-ইখলাস ১১২:১'},
  {bn:'নিশ্চয়ই সত্যবাদিতা পুণ্যের দিকে পরিচালিত করে।',ref:'সহীহ বুখারী'},
  {bn:'আল্লাহ সুন্দর এবং সৌন্দর্যকে ভালোবাসেন।',ref:'সহীহ মুসলিম'},
  {bn:'না, আমার পালনকর্তা আমার সাথে আছেন।',ref:'সূরা আশ-শুআরা ২৬:৬২'},
];
function randVerse(){return VERSES[Math.floor(Math.random()*VERSES.length)];}
function showVerse(id){
  const el=document.getElementById(id);if(!el)return;
  const v=randVerse();
  el.innerHTML=`<div class="vtext">${v.bn}</div><div class="vref">${v.ref}</div>`;
}

// ═══════════════════════════════════════════════════════════════
// REGION CACHE  — single fetch per 3km move, 5min TTL
// Shared by home + explore + map → ~2-4 requests/session
// ═══════════════════════════════════════════════════════════════
const CACHE={
  markers:[],feed:[],
  lat:null,lon:null,ts:0,
  STALE_MS:5*60*1000,MOVE_KM:3,
  fresh(lat,lon){
    if(!this.lat||Date.now()-this.ts>this.STALE_MS) return false;
    return hav(lat,lon,this.lat,this.lon)<=this.MOVE_KM;
  },
  async load(lat,lon){
    if(this.fresh(lat,lon)) return true;
    const d=await api('GET',`/api/region?lat=${lat}&lon=${lon}`);
    if(d.error||!d.markers) return false;
    this.markers=d.markers;this.feed=d.feed;
    this.lat=lat;this.lon=lon;this.ts=Date.now();
    return true;
  },
  invalidate(){this.ts=0;},
};

// ── State ─────────────────────────────────────────────────────
const S={
  token:null,anon_id:null,
  userLat:null,userLon:null,
  reportLat:null,reportLon:null,pinInRange:null,
  mapReady:false,activeTab:'home',_authCb:null,
};
(function(){
  try{
    const t=localStorage.getItem('jb_token'),a=localStorage.getItem('jb_aid');
    if(t&&a){S.token=t;S.anon_id=parseInt(a)||null;}
  }catch{}
})();

// ── Geohash (bundled) ─────────────────────────────────────────
(function(){
  const B='0123456789bcdefghjkmnpqrstuvwxyz';
  function enc(lat,lon,p){
    let i=0,b=0,e=true,h='';
    let la=-90,La=90,lo=-180,Lo=180;
    while(h.length<p){
      if(e){const m=(lo+Lo)/2;if(lon>m){i=(i<<1)|1;lo=m;}else{i<<=1;Lo=m;}}
      else{const m=(la+La)/2;if(lat>m){i=(i<<1)|1;la=m;}else{i<<=1;La=m;}}
      e=!e;if(++b===5){h+=B[i];b=0;i=0;}
    }return h;
  }
  window._gh={enc};
})();

// ── Utils ─────────────────────────────────────────────────────
function hav(la1,lo1,la2,lo2){
  const R=6371,r=d=>d*Math.PI/180;
  const a=Math.sin(r(la2-la1)/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(r(lo2-lo1)/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function cellPx(zoom,lat){
  const mpp=156543.034*Math.cos((lat||23.8)*Math.PI/180)/Math.pow(2,zoom);
  return Math.max(28,Math.round(200/mpp));
}
function mkPin(size,cls,thumb){
  const bg=thumb?`background-image:url('${thumb}');background-size:cover;background-position:center;`:'';
  return L.divIcon({
    html:`<div class="nm-pin ${cls}" style="width:${size}px;height:${size}px;${bg}">${!thumb?'<div class="nm-noimg">📰</div>':''}</div>`,
    iconSize:[size,size+7],iconAnchor:[size/2,size+7],className:'',
  });
}
function rt(u){const d=Math.floor(Date.now()/1000)-u;if(d<60)return d+'সে';if(d<3600)return Math.floor(d/60)+'মি';if(d<86400)return Math.floor(d/3600)+'ঘ';return Math.floor(d/86400)+'দিন';}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function pct(n){const t=+n.real_score+(+n.fake_score);return t>0?Math.round((+n.real_score/t)*100):50;}

// ── API — 401 → auto-logout ───────────────────────────────────
async function api(method,url,body,isForm){
  const o={method,headers:{}};
  if(S.token) o.headers['Authorization']='Bearer '+S.token;
  if(body){if(isForm)o.body=body;else{o.headers['Content-Type']='application/json';o.body=JSON.stringify(body);}}
  try{
    const r=await fetch(url,o);
    const ct=r.headers.get('content-type')||'';
    if(!ct.includes('application/json')) return{error:'সার্ভার ত্রুটি ('+r.status+')'};
    const d=await r.json();d._status=r.status;
    if(r.status===401&&S.token){
      S.token=null;S.anon_id=null;
      try{localStorage.removeItem('jb_token');localStorage.removeItem('jb_aid');}catch{}
      renderUser();
      toast('সেশন শেষ — আবার লগইন করুন',true);
      openAuth();
    }
    return d;
  }catch{return{error:'নেটওয়ার্ক ত্রুটি'};}
}

// ── Toast ─────────────────────────────────────────────────────
let _tt;
function toast(msg,err){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='toast show'+(err?' err':'');
  clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),3500);
}

// ── GPS ───────────────────────────────────────────────────────
function gps(){
  return new Promise(res=>{
    if(S.userLat!==null) return res({lat:S.userLat,lon:S.userLon});
    if(!navigator.geolocation){S.userLat=23.8103;S.userLon=90.4125;return res({lat:23.8103,lon:90.4125});}
    navigator.geolocation.getCurrentPosition(
      p=>{S.userLat=p.coords.latitude;S.userLon=p.coords.longitude;res({lat:S.userLat,lon:S.userLon});},
      ()=>{if(!S.userLat){S.userLat=23.8103;S.userLon=90.4125;}res({lat:S.userLat,lon:S.userLon});},
      {enableHighAccuracy:true,timeout:8000,maximumAge:60000}
    );
  });
}

// ── Tab router ────────────────────────────────────────────────
function switchTab(name){
  if(name==='report'&&!S.token){S._authCb=()=>switchTab('report');openAuth();return;}
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tbb,.dn-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  const el=document.getElementById('screen-'+name);if(el)el.classList.add('active');
  S.activeTab=name;
  const vm={home:'vh',map:'vm',explore:'ve',user:'vu'};
  if(vm[name]) showVerse(vm[name]);
  if(name==='home')    loadHome();
  if(name==='map')     initMap();
  if(name==='explore') loadExplore();
  if(name==='user')    renderUser();
  if(name==='report')  initReportMap();
}

// ── Marker Manager — reads CACHE, no own fetch ────────────────
const NM={
  markers:{},_busy:false,
  reset(){Object.values(this.markers).forEach(m=>{if(MAP)MAP.removeLayer(m.layer);});this.markers={};},
  async update(center,zoom){
    if(this._busy)return;this._busy=true;
    try{
      const lat=center.lat,lon=center.lng;
      await CACHE.load(lat,lon);
      this._apply(CACHE.markers,zoom,lat);
    }finally{this._busy=false;}
  },
  _apply(data,zoom,lat){
    const seen=new Set(),sz=cellPx(zoom,lat||23.8);
    data.forEach(n=>{
      seen.add(n.id);
      const diff=(+n.real_score)-(+n.fake_score),cls=diff>2?'pr':diff<-2?'pf':'pn';
      if(!this.markers[n.id]){
        const layer=L.marker([+n.lat,+n.lon],{icon:mkPin(sz,cls,n.thumb||'')}).addTo(MAP);
        layer.on('click',()=>{MAP.flyTo([+n.lat,+n.lon],Math.max(MAP.getZoom(),18),{duration:0.4});openModal(n.id);});
        this.markers[n.id]={layer,cls,thumb:n.thumb||''};
      }
    });
    Object.entries(this.markers).forEach(([id,m])=>{
      if(!seen.has(id)){if(MAP)MAP.removeLayer(m.layer);delete this.markers[id];}
    });
    Object.values(this.markers).forEach(({layer,cls,thumb})=>layer.setIcon(mkPin(sz,cls,thumb)));
    const el=document.getElementById('cell-count');if(el)el.textContent=`📍 ${Object.keys(this.markers).length}টি সংবাদ`;
    const info=document.getElementById('map-info');if(info)info.textContent=`📡 ${Object.keys(this.markers).length}টি লোড`;
  },
};

// ── Main Map ──────────────────────────────────────────────────
let MAP=null,uCircle=null,uDot=null,_mpd=null;

async function initMap(){
  if(S.mapReady){setTimeout(()=>{if(MAP){MAP.invalidateSize();trigLoad();}},80);return;}
  S.mapReady=true;
  const{lat,lon}=await gps();
  MAP=L.map('map',{zoomControl:false,preferCanvas:true,tap:true}).setView([lat,lon],16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; OSM',maxZoom:21,keepBuffer:2,updateWhenIdle:false,updateWhenZooming:false,
  }).addTo(MAP);
  L.control.zoom({position:'bottomright'}).addTo(MAP);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{MAP.invalidateSize();drawUser(lat,lon);trigLoad();}));
  MAP.on('moveend',()=>{clearTimeout(_mpd);_mpd=setTimeout(trigLoad,400);});
  MAP.on('zoomend',()=>{clearTimeout(_mpd);_mpd=setTimeout(()=>{
    if(MAP) NM._apply(CACHE.markers,MAP.getZoom(),MAP.getCenter().lat);
  },200);});
}
function trigLoad(){if(MAP)NM.update(MAP.getCenter(),MAP.getZoom());}
function drawUser(lat,lon){
  if(uCircle){uCircle.remove();uDot&&uDot.remove();}
  uCircle=L.circle([lat,lon],{radius:5000,color:'#00d496',weight:1.5,opacity:.4,dashArray:'6 5',fillColor:'#00d496',fillOpacity:.03,interactive:false}).addTo(MAP);
  uDot=L.circleMarker([lat,lon],{radius:8,color:'#fff',weight:2.5,fillColor:'#4c7bff',fillOpacity:1,interactive:false}).addTo(MAP);
}
function locateMe(){
  if(!MAP)return;S.userLat=null;
  gps().then(({lat,lon})=>{MAP.flyTo([lat,lon],16,{duration:0.8});drawUser(lat,lon);toast('অবস্থান আপডেট হয়েছে');});
}

// ── Report Map ────────────────────────────────────────────────
let RMAP=null,rPinGroup=null,rMapReady=false;

async function initReportMap(){
  if(rMapReady)return;rMapReady=true;
  const{lat,lon}=await gps();
  RMAP=L.map('report-map',{zoomControl:true,tap:true}).setView([lat,lon],17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:21,attribution:'&copy; OSM'}).addTo(RMAP);
  L.circle([lat,lon],{radius:5000,color:'#00d496',weight:1.5,opacity:.6,dashArray:'7 5',fillColor:'#00d496',fillOpacity:.04,interactive:false}).addTo(RMAP);
  L.circleMarker([lat,lon],{radius:9,color:'#fff',weight:2.5,fillColor:'#4c7bff',fillOpacity:1,interactive:false}).addTo(RMAP);
  rPinGroup=L.layerGroup().addTo(RMAP);
  const hint=document.getElementById('rmap-hint'),st=document.getElementById('rmap-st');
  RMAP.on('click',async e=>{
    const plat=e.latlng.lat,plon=e.latlng.lng,dist=hav(lat,lon,plat,plon);
    const inRange=dist<=5;
    S.reportLat=plat;S.reportLon=plon;S.pinInRange=inRange;
    rPinGroup.clearLayers(); // ONE pin — atomically cleared every tap
    const c5=0.000045;
    L.rectangle([[plat-c5,plon-c5],[plat+c5,plon+c5]],{color:inRange?'#00d496':'#ff4b6e',weight:2.5,fillColor:inRange?'#00d496':'#ff4b6e',fillOpacity:0.4}).addTo(rPinGroup);
    L.circleMarker([plat,plon],{radius:5,color:'#fff',weight:2,fillColor:inRange?'#00d496':'#ff4b6e',fillOpacity:1}).addTo(rPinGroup);
    hint.style.display='none';st.style.display='block';
    if(!inRange){st.textContent=`${dist.toFixed(2)} কিমি — ৫ কিমি সীমার বাইরে ✗`;st.className='rst-bad';return;}
    st.textContent=`পরীক্ষা করছি…`;st.className='';
    // Use CACHE — zero extra request
    await CACHE.load(lat,lon);
    const cell=window._gh.enc(plat,plon,9);
    const occupied=CACHE.markers.some(n=>window._gh.enc(+n.lat,+n.lon,9)===cell);
    if(occupied){st.textContent=`এই ঘরে ইতিমধ্যে সংবাদ আছে ⚠`;st.className='rst-cell';S.pinInRange=false;}
    else{st.textContent=`${dist.toFixed(2)} কিমি — ঘর খালি ✓`;st.className='rst-ok';}
  });
  setTimeout(()=>RMAP.invalidateSize(),120);
}

function prevImgs(input){
  const p=document.getElementById('img-prev');p.innerHTML='';
  [...input.files].slice(0,10).forEach(f=>{const i=document.createElement('img');i.src=URL.createObjectURL(f);p.appendChild(i);});
}

async function submitReport(){
  if(!S.token){openAuth();return;}
  const title=document.getElementById('r-title').value.trim();
  const desc=document.getElementById('r-desc').value.trim();
  const links=document.getElementById('r-links').value.trim();
  const imgs=document.getElementById('r-images').files;
  if(!title){toast('শিরোনাম আবশ্যক',true);return;}
  if(!S.reportLat){toast('মানচিত্রে পিন করুন',true);return;}
  if(S.pinInRange===false){toast('পিন সীমার বাইরে বা ঘর পূর্ণ',true);return;}
  const btn=document.getElementById('submit-btn');
  if(btn.disabled)return;
  btn.disabled=true;btn.textContent='প্রকাশ হচ্ছে…';
  const ul=S.userLat??S.reportLat,ulo=S.userLon??S.reportLon;
  const fd=new FormData();
  fd.append('title',title);fd.append('description',desc);
  fd.append('lat',S.reportLat);fd.append('lon',S.reportLon);
  fd.append('links',links);fd.append('user_lat',ul);fd.append('user_lon',ulo);
  [...imgs].forEach(f=>fd.append('images',f));
  const r=await api('POST','/api/news',fd,true);
  btn.disabled=false;btn.textContent='প্রকাশ করুন';
  if(r.error){toast('ত্রুটি: '+r.error,true);return;}
  toast('প্রকাশিত হয়েছে ✓');
  CACHE.invalidate();
  ['r-title','r-desc','r-links'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('r-images').value='';
  document.getElementById('img-prev').innerHTML='';
  const st=document.getElementById('rmap-st');if(st){st.style.display='none';st.className='';}
  document.getElementById('rmap-hint').style.display='block';
  S.reportLat=null;S.reportLon=null;S.pinInRange=null;
  if(rPinGroup)rPinGroup.clearLayers();
  rMapReady=false;if(RMAP){RMAP.remove();RMAP=null;}rPinGroup=null;
  NM.reset();S.mapReady=false;
  switchTab('home');
}

// ── Donation section ──────────────────────────────────────────
function donationHTML(){
  return`<div class="donate-card glass">
    <div class="dc-head">
      <span style="font-size:22px">🤲</span>
      <div>
        <div style="font-weight:800;font-size:15px;color:var(--gold)">সহযোগিতা করুন</div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px">BD News Map v10</div>
      </div>
    </div>
    <p class="dc-msg">এই অ্যাপটি সত্যিকারে কার্যকরভাবে রিলিজ করতে আপনাদের সাহায্য প্রয়োজন।</p>
    <div class="dc-methods">
      <div class="dc-method" onclick="copyNum('bKash')">
        <div class="dc-logo" style="background:#E2136E">bK</div>
        <div class="dc-info"><div class="dc-label">bKash</div><div class="dc-num">01710552580</div></div>
        <div class="dc-copy">📋</div>
      </div>
      <div class="dc-method" onclick="copyNum('Nagad')">
        <div class="dc-logo" style="background:#F7941D">Ng</div>
        <div class="dc-info"><div class="dc-label">Nagad</div><div class="dc-num">01710552580</div></div>
        <div class="dc-copy">📋</div>
      </div>
      <div class="dc-method" onclick="copyNum('Rocket')">
        <div class="dc-logo" style="background:#8B1DB8">Rk</div>
        <div class="dc-info"><div class="dc-label">Rocket</div><div class="dc-num">01710552580</div></div>
        <div class="dc-copy">📋</div>
      </div>
    </div>
    <div class="dc-footer">সংবাদ হোক দালাল মুক্ত — জনতার বার্তা</div>
  </div>`;
}
function copyNum(svc){
  const num='01710552580';
  navigator.clipboard.writeText(num).then(()=>toast(svc+' নম্বর কপি: '+num)).catch(()=>toast(num));
}

// ── Home ──────────────────────────────────────────────────────
async function loadHome(){
  const el=document.getElementById('home-content');
  el.innerHTML='<div class="sp-box"><b></b><b></b><b></b></div>';
  const{lat,lon}=await gps();
  const ok=await CACHE.load(lat,lon);
  const feed=CACHE.feed;
  if(!ok||!feed.length){
    el.innerHTML=`<div class="empty"><div class="ei">🗺️</div><p>আশেপাশে এখনো কোনো সংবাদ নেই।<br>আপনিই প্রথম রিপোর্ট করুন!</p></div>${donationHTML()}`;
    return;
  }
  const bc=n=>+n.real_score>+n.fake_score?'breal':+n.fake_score>+n.real_score?'bfake':'bneu';
  const bt=n=>+n.real_score>+n.fake_score?'✓ যাচাইকৃত':+n.fake_score>+n.real_score?'⚠ সন্দেহজনক':'◉ যাচাই চলছে';
  const hero=feed[0],rest=feed.slice(1,5),later=feed.slice(5);
  el.innerHTML=`
    <div class="slabel">আপনার কাছাকাছি</div>
    <div class="hcard glass" onclick="openModal('${hero.id}')">
      ${hero.thumb?`<img class="h-img" src="${esc(hero.thumb)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="h-noimg">📰</div>`}
      <div class="h-body">
        <span class="hbadge ${bc(hero)}">${bt(hero)}</span>
        <div class="htitle">${esc(hero.title)}</div>
        <div class="hmeta"><span>${rt(hero.created_at)}</span><span>${hav(lat,lon,+hero.lat,+hero.lon).toFixed(1)} কিমি</span><span>${+(hero.vote_count||0)} ভোট</span></div>
        <div class="tbw"><div class="tb" style="width:${pct(hero)}%"></div></div>
      </div>
    </div>
    ${rest.length?`<div class="slabel" style="margin-top:16px">সাম্প্রতিক সংবাদ</div>
    <div class="crow">${rest.map(n=>`<div class="mcard glass" onclick="openModal('${n.id}')">
      ${n.thumb?`<img class="m-img" src="${esc(n.thumb)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="m-noimg">📰</div>`}
      <div class="m-body"><div class="m-title">${esc(n.title)}</div>
      <div class="m-meta"><span class="sp ${+n.real_score>+n.fake_score?'sp-r':'sp-f'}">${pct(n)}%</span><span>${hav(lat,lon,+n.lat,+n.lon).toFixed(1)}কিমি</span></div></div>
    </div>`).join('')}</div>`:``}
    ${later.length?`<div class="slabel" style="margin-top:16px">আরো সংবাদ</div>
    ${later.map(n=>`<div class="lcard glass" onclick="openModal('${n.id}')">
      ${n.thumb?`<img class="l-img" src="${esc(n.thumb)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="l-noimg">📰</div>`}
      <div class="l-body"><div class="l-title">${esc(n.title)}</div><div class="l-meta">${rt(n.created_at)} · ${hav(lat,lon,+n.lat,+n.lon).toFixed(1)} কিমি</div></div>
      <div class="l-sc ${+n.real_score>+n.fake_score?'sc-r':'sc-f'}">${pct(n)}%</div>
    </div>`).join('')}`:``}
    ${donationHTML()}`;
}

// ── Explore — zero extra request (reuses CACHE) ───────────────
async function loadExplore(){
  const el=document.getElementById('explore-content');
  el.innerHTML='<div class="sp-box"><b></b><b></b><b></b></div>';
  const{lat,lon}=await gps();
  await CACHE.load(lat,lon);
  const feed=CACHE.feed;
  if(!feed.length){el.innerHTML='<div class="empty"><div class="ei">🔍</div><p>আশেপাশে কিছু নেই।</p></div>';return;}
  el.innerHTML=feed.map(n=>`<div class="lcard glass" onclick="openModal('${n.id}')">
    ${n.thumb?`<img class="l-img" src="${esc(n.thumb)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="l-noimg">📰</div>`}
    <div class="l-body"><div class="l-title">${esc(n.title)}</div><div class="l-meta">${rt(n.created_at)} · ${hav(lat,lon,+n.lat,+n.lon).toFixed(1)} কিমি</div></div>
    <div class="l-sc ${+n.real_score>+n.fake_score?'sc-r':'sc-f'}">${pct(n)}%</div>
  </div>`).join('');
}

// ── Modal ─────────────────────────────────────────────────────
async function openModal(newsId){
  const ol=document.getElementById('modal-overlay');
  const ct=document.getElementById('modal-content');
  ct.innerHTML='<div class="sp-box"><b></b><b></b><b></b></div>';
  ol.classList.add('open');document.body.style.overflow='hidden';
  const n=await api('GET','/api/news/'+newsId);
  if(n.error){ct.innerHTML=`<div class="empty"><p>${esc(n.error)}</p></div>`;return;}
  const dist=S.userLat!=null?hav(S.userLat,S.userLon,+n.lat,+n.lon):null;
  const canVote=S.token&&dist!=null&&dist<=5;
  const real=+(n.real_score||0),fake=+(n.fake_score||0);
  const total=real+fake,p=total>0?Math.round((real/total)*100):50;
  const images=Array.isArray(n.images)?n.images:[];
  const isOwner=S.anon_id&&n.owner_id&&Number(n.owner_id)===Number(S.anon_id);
  const ageS=Math.floor(Date.now()/1000)-(+n.created_at||0);
  const canDel=isOwner&&ageS<10800;
  const rawLinks=(n.links||'').trim();
  const linksHTML=rawLinks?rawLinks.split(/[\s,]+/).filter(Boolean).map(l=>`<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//,'').slice(0,45))}</a>`).join(''):'';
  ct.innerHTML=`
    ${images.length?`<div class="mcar">${images.map((s,i)=>`<div class="mslide"><img src="${esc(s)}" loading="lazy" style="width:100%;height:210px;object-fit:cover;border-radius:11px;display:block" onerror="this.closest('.mslide').style.display='none'">${images.length>1?`<div class="mcar-n">${i+1}/${images.length}</div>`:''}</div>`).join('')}</div>`:`<div class="noimgph">📷 ছবি নেই</div>`}
    <div class="mtitle">${esc(n.title)}</div>
    <div class="mchips">
      <span class="mchip">🕐 ${rt(+n.created_at)}</span>
      ${dist!=null?`<span class="mchip ${dist>5?'mchip-w':''}">${dist>5?'🔴':'🟢'} ${dist.toFixed(2)} কিমি</span>`:''}
    </div>
    ${n.description?`<div class="mdesc">${esc(n.description)}</div>`:''}
    <div class="tbox">
      <div class="tbls"><span class="tbf">মিথ্যা ${fake.toFixed(1)}</span><span class="tbr">সত্য ${real.toFixed(1)}</span></div>
      <div class="tbw"><div class="tb" style="width:${p}%"></div></div>
      <div class="tbpct">${p}% সত্যতা · ${+(n.vote_count||0)} ভোট</div>
    </div>
    <div class="vrow">
      <button class="bvote bvr" onclick="castVote('${n.id}','real')" ${!canVote?'disabled':''}>✓ সত্য</button>
      <button class="bvote bvf" onclick="castVote('${n.id}','fake')" ${!canVote?'disabled':''}>✗ মিথ্যা</button>
    </div>
    <div class="vhint">${!S.token?'ভোট দিতে লগইন করুন':dist==null?'লোকেশন চালু করুন':dist>5?`${dist.toFixed(1)} কিমি দূরে (৫ কিমির বাইরে)`:`${dist.toFixed(2)} কিমি — ভোট দিতে পারবেন ✓`}</div>
    ${linksHTML?`<div style="margin-bottom:11px"><div class="dlbl" style="margin-bottom:4px">📎 সূত্র</div><div class="mlinks">${linksHTML}</div></div>`:''}
    <div class="dgrid">
      <div class="ditem"><div class="dlbl">স্থানাঙ্ক</div><div class="dval">${(+n.lat).toFixed(4)}°, ${(+n.lon).toFixed(4)}°</div></div>
      <div class="ditem"><div class="dlbl">ঘর</div><div class="dval" style="font-size:10px;word-break:break-all">${n.gh_cell||'—'}</div></div>
    </div>
    ${canDel?`<button class="bdel" onclick="delNews('${n.id}')">🗑 মুছুন (${Math.max(0,Math.round((10800-ageS)/60))} মিনিট)</button>`:''}`;
}
function closeModal(e){
  if(e.target===document.getElementById('modal-overlay')){
    document.getElementById('modal-overlay').classList.remove('open');
    document.body.style.overflow='';
  }
}
async function castVote(nid,type){
  if(!S.token){openAuth();return;}
  if(S.userLat==null){toast('লোকেশন চালু করুন',true);return;}
  const r=await api('POST','/api/vote',{news_id:nid,type,user_lat:S.userLat,user_lon:S.userLon});
  if(r.error){toast(r.error,true);return;}
  toast(`ভোট দেওয়া হয়েছে (ওজন: ${r.weight})`);
  CACHE.invalidate();openModal(nid);
}
async function delNews(nid){
  if(!confirm('এই রিপোর্ট মুছে ফেলবেন?'))return;
  const r=await api('DELETE','/api/news/'+nid);
  if(r.error){toast(r.error,true);return;}
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow='';
  if(NM.markers[nid]){if(MAP)MAP.removeLayer(NM.markers[nid].layer);delete NM.markers[nid];}
  CACHE.invalidate();toast('মুছে ফেলা হয়েছে');loadHome();
}

// ── Auth ──────────────────────────────────────────────────────
function openAuth(){document.getElementById('auth-overlay').classList.add('open');}
function closeAuth(){document.getElementById('auth-overlay').classList.remove('open');S._authCb=null;}
function closeAuthBg(e){if(e.target===document.getElementById('auth-overlay'))closeAuth();}
let _authMode='login';
function authTab(m){
  _authMode=m;
  document.getElementById('atab-l').classList.toggle('active',m==='login');
  document.getElementById('atab-r').classList.toggle('active',m==='register');
  document.getElementById('a-pass').setAttribute('autocomplete',m==='register'?'new-password':'current-password');
}
async function doAuth(e){
  if(e)e.preventDefault();
  const phone=document.getElementById('a-phone').value.trim();
  const password=document.getElementById('a-pass').value;
  if(!phone||!password){toast('সব তথ্য দিন',true);return;}
  const btn=document.getElementById('auth-btn');
  btn.disabled=true;btn.textContent='লোড হচ্ছে…';
  const r=await api('POST',_authMode==='login'?'/api/login':'/api/register',{phone,password});
  btn.disabled=false;btn.textContent='প্রবেশ করুন';
  if(r.error){toast(r.error,true);return;}
  S.token=r.token;S.anon_id=r.anon_id||null;
  try{localStorage.setItem('jb_token',r.token);localStorage.setItem('jb_aid',String(r.anon_id||''));}catch{}
  toast('লগইন হয়েছে ✓');
  closeAuth();renderUser();
  if(S._authCb){const cb=S._authCb;S._authCb=null;cb();}
}
function renderUser(){
  const el=document.getElementById('user-content');
  if(!S.token){
    el.innerHTML=`<div class="empty"><div class="ei">🔐</div><p>লগইন করুন সংবাদ রিপোর্ট করতে</p>
      <button class="btn-p" style="margin-top:10px;padding:12px 28px;border-radius:12px;font-size:14px" onclick="openAuth()">লগইন / নিবন্ধন</button></div>
    ${donationHTML()}`;
    return;
  }
  el.innerHTML=`
    <div class="uhero"><div class="uav">👤</div>
      <div class="uname">익명 সদস্য</div>
      <div class="usub">আপনার পরিচয় গোপন আছে</div>
    </div>
    <div style="padding:0 16px 16px">
      <button class="btn-p" style="background:linear-gradient(135deg,#c01030,#800010)" onclick="logout()">লগআউট</button>
    </div>${donationHTML()}`;
}
function logout(){
  S.token=null;S.anon_id=null;
  try{localStorage.removeItem('jb_token');localStorage.removeItem('jb_aid');}catch{}
  renderUser();toast('লগআউট হয়েছে');
}

// ── Boot ──────────────────────────────────────────────────────
(async function init(){
  gps();showVerse('vh');loadHome();renderUser();
})();
