'use strict';

const fs      = require('fs');
const path    = require('path');
try {
  fs.readFileSync(path.join(__dirname,'.env'),'utf8')
    .split('\n').forEach(l=>{const m=l.match(/^([^#=\s]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();});
} catch {}

const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const ngeohash = require('ngeohash');
const cron     = require('node-cron');

const { initDB, dbGet, dbAll, dbRun, DATA_ROOT } = require('./db');
const log  = require('./middleware/logger');
const auth = require('./middleware/auth');

const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jonatar-barta-secret';
const PROX_KM    = 5;        // vote/post proximity wall
const LOAD_KM    = 10;       // 10km load area
const DELETE_TTL = 3  * 3600;
const PURGE_TTL  = 36 * 3600;
const GH_L5      = 5;
const GH_L9      = 9;        // ~4.8m×4.8m exclusive cell
const MAX_BYTES  = 10 * 1024 * 1024 * 1024; // 10 GB

const IS_VERCEL = !!process.env.VERCEL;
const NEWS_DATA = path.join(DATA_ROOT, 'news_data');
const LOGS_DIR  = path.join(__dirname, 'logs');

[NEWS_DATA, LOGS_DIR].forEach(d=>{if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});});

// ── Geo ───────────────────────────────────────────────────────
function haversine(la1,lo1,la2,lo2){
  const R=6371,r=d=>d*Math.PI/180;
  const a=Math.sin(r(la2-la1)/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(r(lo2-lo1)/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function voteWeight(d){ return Math.max(0.2, 1.0-(d/PROX_KM)*0.8); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

// ── Storage size check ────────────────────────────────────────
function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir,{withFileTypes:true})) {
    const fp=path.join(dir,f.name);
    total += f.isDirectory() ? dirSize(fp) : fs.statSync(fp).size;
  }
  return total;
}

// ── news_data helpers ─────────────────────────────────────────
function newsDir(id)  { return path.join(NEWS_DATA,id); }
function metaFile(id) { return path.join(NEWS_DATA,id,'meta.json'); }
function writeMeta(id,data){ const d=newsDir(id); if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(metaFile(id),JSON.stringify(data,null,2),'utf8'); }
function readMeta(id){ const p=metaFile(id); if(!fs.existsSync(p))return null; try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;} }
function listImages(id){ const d=newsDir(id); if(!fs.existsSync(d))return []; return fs.readdirSync(d).filter(f=>/\.(jpg|jpeg|png|webp|gif)$/i.test(f)).sort().map(f=>`/news_data/${id}/${f}`); }
function deleteNewsDir(id){ const d=newsDir(id); if(fs.existsSync(d))try{fs.rmSync(d,{recursive:true,force:true});}catch{} }

// ── Scores ────────────────────────────────────────────────────
function withScores(rows){
  return rows.map(n=>{
    const vs=dbAll('SELECT type,weight FROM votes WHERE news_id=?',[n.id]);
    let real=0,fake=0;
    for(const v of vs){if(v.type==='real')real+=+v.weight;else fake+=+v.weight;}
    return{...n,real_score:+real.toFixed(3),fake_score:+fake.toFixed(3),vote_count:vs.length};
  });
}

// ── Multer ────────────────────────────────────────────────────
const upload = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:25*1024*1024,files:10},
  fileFilter:(_,f,cb)=>cb(null,/^image\/(jpeg|jpg|png|webp|gif)$/.test(f.mimetype)),
});
const handleUpload = upload.array('images',10);

function saveImages(id,files){
  const d=newsDir(id);
  if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});
  const urls=[];
  (files||[]).forEach((f,i)=>{
    const ext=(path.extname(f.originalname)||'.jpg').toLowerCase();
    const name=`img_${i}${ext}`;
    fs.writeFileSync(path.join(d,name),f.buffer);
    urls.push(`/news_data/${id}/${name}`);
  });
  return urls;
}

// ── Express ───────────────────────────────────────────────────
const app = express();
app.use(express.json({limit:'2mb'}));
app.use(log.middleware);
app.use(express.static(path.join(__dirname,'public'),{
  setHeaders(res,p){ if(p.endsWith('.html')||p.endsWith('.js')) res.set('Cache-Control','no-store'); }
}));
app.use('/news_data', express.static(NEWS_DATA,{maxAge:'5m'}));
app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});

// ── AUTH ──────────────────────────────────────────────────────
// Phone is the identifier. Username is auto-generated anon ID (never shown).
// Format: BD phone = 01XXXXXXXXX (11 digits) or +880XXXXXXXXX
function normalizePhone(p) {
  const d = String(p||'').replace(/\D/g,'');
  if (d.startsWith('880') && d.length===13) return '0'+d.slice(3);
  if (d.length===11 && d.startsWith('01')) return d;
  return null;
}
function anonName(id) {
  // Anonymous display name based on user ID — never reveals identity
  const words=['প্রতিবেদক','সংবাদদাতা','নাগরিক','জনতা','বার্তাবাহক'];
  return words[id % words.length] + '_' + (1000+id);
}

app.post('/api/register', async (req,res)=>{
  const {phone,password}=req.body;
  if(!phone||!password) return res.status(400).json({error:'ফোন নম্বর ও পাসওয়ার্ড দিন'});
  const normPhone=normalizePhone(phone);
  if(!normPhone) return res.status(400).json({error:'সঠিক বাংলাদেশি নম্বর দিন (01XXXXXXXXX)'});
  if(password.length<6) return res.status(400).json({error:'পাসওয়ার্ড কমপক্ষে ৬ অক্ষর'});
  if(dbGet('SELECT id FROM users WHERE phone=?',[normPhone]))
    return res.status(409).json({error:'এই নম্বরে ইতিমধ্যে অ্যাকাউন্ট আছে'});
  const hash=await bcrypt.hash(password,10);
  // Generate temp username from phone tail for uniqueness
  const tempUser='u_'+normPhone.slice(-6)+'_'+Date.now().toString(36);
  dbRun('INSERT INTO users (phone,username,password_hash) VALUES (?,?,?)',[normPhone,tempUser,hash]);
  const user=dbGet('SELECT id FROM users WHERE phone=?',[normPhone]);
  // Update username to anon name based on real ID
  const anon=anonName(user.id);
  dbRun('UPDATE users SET username=? WHERE id=?',[anon,user.id]);
  const token=jwt.sign({id:user.id,username:anon},JWT_SECRET,{expiresIn:'30d'});
  res.json({token,anon_id:user.id});
});

app.post('/api/login', async (req,res)=>{
  const {phone,password}=req.body;
  if(!phone||!password) return res.status(400).json({error:'সব তথ্য দিন'});
  const normPhone=normalizePhone(phone);
  if(!normPhone) return res.status(400).json({error:'সঠিক ফোন নম্বর দিন'});
  const user=dbGet('SELECT * FROM users WHERE phone=?',[normPhone]);
  if(!user) return res.status(401).json({error:'নম্বর বা পাসওয়ার্ড ভুল'});
  if(!await bcrypt.compare(password,user.password_hash))
    return res.status(401).json({error:'নম্বর বা পাসওয়ার্ড ভুল'});
  const token=jwt.sign({id:user.id,username:user.username},JWT_SECRET,{expiresIn:'30d'});
  res.json({token,anon_id:user.id});
});

// ── POST NEWS ─────────────────────────────────────────────────
app.post('/api/news', auth, handleUpload, (req,res)=>{
  const {title,description,lat,lon,links,user_lat,user_lon}=req.body;
  if(!title||!lat||!lon) return res.status(400).json({error:'শিরোনাম, অবস্থান আবশ্যক'});
  const flat=parseFloat(lat),flon=parseFloat(lon);
  if(isNaN(flat)||isNaN(flon)) return res.status(400).json({error:'অবৈধ স্থানাঙ্ক'});
  const ulat=parseFloat(user_lat),ulon=parseFloat(user_lon);
  if(isNaN(ulat)||isNaN(ulon)) return res.status(400).json({error:'আপনার GPS অবস্থান প্রয়োজন'});

  // 5km post wall
  const pinDist=haversine(ulat,ulon,flat,flon);
  if(pinDist>PROX_KM) return res.status(403).json({error:`পিন আপনার থেকে ${pinDist.toFixed(2)} কিমি দূরে। সর্বোচ্চ ${PROX_KM} কিমি।`});

  // 10GB storage cap
  const used=dirSize(NEWS_DATA);
  if(used>=MAX_BYTES) return res.status(507).json({error:'স্টোরেজ সীমা পূর্ণ হয়ে গেছে (১০ জিবি)'});

  // geohash-9 cell exclusivity (~4.8m×4.8m)
  const gh_cell=ngeohash.encode(flat,flon,GH_L9);
  const existing=dbGet('SELECT id FROM news WHERE gh_cell=?',[gh_cell]);
  if(existing) return res.status(409).json({error:'এই স্থানে (৫মি×৫মি) ইতিমধ্যে একটি সংবাদ আছে'});

  const id       = uid();
  const gh_chunk = ngeohash.encode(flat,flon,GH_L5);
  const gh_sub   = ngeohash.encode(flat,flon,6);
  const now      = Math.floor(Date.now()/1000);
  const nDir     = path.join(NEWS_DATA,id);

  function rollback(reason){
    log.warn('ROLLBACK',id,reason);
    try{if(fs.existsSync(nDir))fs.rmSync(nDir,{recursive:true,force:true});}catch{}
    try{dbRun('DELETE FROM news WHERE id=?',[id]);}catch{}
  }

  let imageUrls=[];
  try{ imageUrls=saveImages(id,req.files||[]); }
  catch(e){ rollback('saveImages: '+e.message); return res.status(500).json({error:'ছবি সংরক্ষণ ব্যর্থ'}); }

  const meta={id,owner_id:req.user.id,username:req.user.username,
    title:title.trim(),description:(description||'').trim(),
    lat:flat,lon:flon,gh_chunk,gh_sub,gh_cell,
    links:(links||'').trim(),image_count:imageUrls.length,images:imageUrls,
    thumb:imageUrls[0]||'',created_at:now};
  try{ writeMeta(id,meta); }
  catch(e){ rollback('writeMeta: '+e.message); return res.status(500).json({error:'রেকর্ড সংরক্ষণ ব্যর্থ'}); }

  try{
    dbRun(
      `INSERT INTO news (id,owner_id,title,description,lat,lon,gh_chunk,gh_sub,gh_cell,links,image_count,thumb,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,req.user.id,meta.title,meta.description,flat,flon,
       gh_chunk,gh_sub,gh_cell,meta.links,imageUrls.length,imageUrls[0]||'',now]
    );
  } catch(e){ log.error('DB INDEX (non-fatal)',e.message); }

  log.info('NEWS COMMITTED',id,`cell=${gh_cell}`,`images=${imageUrls.length}`);
  res.json({id,gh_cell,image_count:imageUrls.length});
});

// ── /api/region — ONE endpoint replaces /nearby + /feed ─────────
// Returns {markers:[...], feed:[...]} so client needs only 1 call
// markers: all news in 10km bbox for map (minimal fields)
// feed:    top 20 by truth score for home/explore (full fields)
app.get('/api/region', (req,res)=>{
  const flat=parseFloat(req.query.lat),flon=parseFloat(req.query.lon);
  if(isNaN(flat)||isNaN(flon)) return res.status(400).json({error:'lat/lon required'});
  const dlat=0.09, dlon=0.10;
  const cutoff=Math.floor(Date.now()/1000)-PURGE_TTL;
  // One query gets everything
  const rows=dbAll(
    `SELECT id,owner_id,lat,lon,gh_cell,title,description,links,image_count,thumb,created_at
     FROM news
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND created_at>?
     ORDER BY created_at DESC LIMIT 2000`,
    [flat-dlat,flat+dlat,flon-dlon,flon+dlon,cutoff]
  );
  // Attach scores to all rows at once (one loop)
  const allIds=rows.map(r=>r.id);
  const voteMap={};
  if(allIds.length){
    const ph=allIds.map(()=>'?').join(',');
    const votes=dbAll(`SELECT news_id,type,weight FROM votes WHERE news_id IN (${ph})`,allIds);
    for(const v of votes){
      if(!voteMap[v.news_id]) voteMap[v.news_id]={real:0,fake:0,count:0};
      if(v.type==='real') voteMap[v.news_id].real+=+v.weight;
      else voteMap[v.news_id].fake+=+v.weight;
      voteMap[v.news_id].count++;
    }
  }
  const scored=rows.map(n=>{
    const v=voteMap[n.id]||{real:0,fake:0,count:0};
    return{...n,real_score:+v.real.toFixed(2),fake_score:+v.fake.toFixed(2),vote_count:v.count};
  });
  // markers: minimal fields for map pins
  const markers=scored.map(n=>({id:n.id,lat:n.lat,lon:n.lon,gh_cell:n.gh_cell,thumb:n.thumb,real_score:n.real_score,fake_score:n.fake_score}));
  // feed: top 20 sorted by truth score
  const feed=[...scored].sort((a,b)=>(b.real_score-b.fake_score)-(a.real_score-a.fake_score)).slice(0,20);
  res.json({markers,feed,ts:Date.now()});
});

// ── Keep /api/news/nearby as alias (for report-map cell check only) ──
app.get('/api/news/nearby', (req,res)=>{
  const flat=parseFloat(req.query.lat),flon=parseFloat(req.query.lon);
  if(isNaN(flat)||isNaN(flon)) return res.status(400).json({error:'lat/lon required'});
  const dlat=0.009, dlon=0.010; // only 1km box for cell check
  const rows=dbAll(
    `SELECT id,lat,lon,gh_cell FROM news
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
     LIMIT 200`,
    [flat-dlat,flat+dlat,flon-dlon,flon+dlon]
  );
  res.json(rows);
});

// ── NEWS DETAIL ───────────────────────────────────────────────
app.get('/api/news/:id', (req,res)=>{
  const {id}=req.params;
  const meta=readMeta(id);
  if(meta){
    const vs=dbAll('SELECT type,weight FROM votes WHERE news_id=?',[id]);
    let real=0,fake=0;
    for(const v of vs){if(v.type==='real')real+=+v.weight;else fake+=+v.weight;}
    const images=listImages(id);
    return res.json({...meta,images,image_count:images.length,
      real_score:+real.toFixed(3),fake_score:+fake.toFixed(3),vote_count:vs.length});
  }
  const row=dbGet(
    `SELECT n.*,COALESCE(u.username,'[অজ্ঞাত]') AS _anon
     FROM news n LEFT JOIN users u ON u.id=n.owner_id WHERE n.id=?`,[id]);
  if(!row) return res.status(404).json({error:'সংবাদ পাওয়া যায়নি'});
  const vs=dbAll('SELECT type,weight FROM votes WHERE news_id=?',[id]);
  let real=0,fake=0;
  for(const v of vs){if(v.type==='real')real+=+v.weight;else fake+=+v.weight;}
  const images=listImages(id);
  res.json({...row,description:row.description||'',links:row.links||'',
    images,image_count:images.length,
    real_score:+real.toFixed(3),fake_score:+fake.toFixed(3),vote_count:vs.length});
});

// ── DELETE ────────────────────────────────────────────────────
app.delete('/api/news/:id', auth, (req,res)=>{
  const {id}=req.params;
  const meta=readMeta(id);
  const row=!meta?dbGet('SELECT owner_id,created_at FROM news WHERE id=?',[id]):null;
  const ownerId=meta?meta.owner_id:row?.owner_id;
  const createdAt=meta?meta.created_at:row?.created_at;
  if(!ownerId) return res.status(404).json({error:'পাওয়া যায়নি'});
  if(ownerId!==req.user.id) return res.status(403).json({error:'অনুমতি নেই'});
  const age=Math.floor(Date.now()/1000)-createdAt;
  if(age>DELETE_TTL) return res.status(403).json({error:`মুছে ফেলার সময় শেষ (${Math.floor(age/60)} মিনিট হয়ে গেছে)`});
  try{dbRun('DELETE FROM news WHERE id=?',[id]);}catch{}
  try{dbRun('DELETE FROM votes WHERE news_id=?',[id]);}catch{}
  deleteNewsDir(id);
  log.info('NEWS DELETED',id,'by',req.user.username);
  res.json({deleted:true});
});

// ── VOTE ──────────────────────────────────────────────────────
app.post('/api/vote', auth, (req,res)=>{
  const {news_id,type,user_lat,user_lon}=req.body;
  if(!news_id||!['real','fake'].includes(type)) return res.status(400).json({error:'অবৈধ ভোট'});
  const ulat=parseFloat(user_lat),ulon=parseFloat(user_lon);
  if(isNaN(ulat)||isNaN(ulon)) return res.status(400).json({error:'GPS প্রয়োজন'});
  const news=dbGet('SELECT lat,lon FROM news WHERE id=?',[news_id]);
  if(!news) return res.status(404).json({error:'সংবাদ পাওয়া যায়নি'});
  const d=haversine(ulat,ulon,+news.lat,+news.lon);
  if(d>PROX_KM) return res.status(403).json({error:`${d.toFixed(2)} কিমি দূরে — ভোট দেওয়া যাবে না`});
  const w=voteWeight(d);
  try{
    dbRun(`INSERT INTO votes (news_id,user_id,type,weight) VALUES (?,?,?,?)
           ON CONFLICT(news_id,user_id) DO UPDATE SET type=excluded.type,weight=excluded.weight,voted_at=strftime('%s','now')`,
      [news_id,req.user.id,type,w]);
  } catch(e){ return res.status(500).json({error:'ভোট সংরক্ষণ ব্যর্থ'}); }
  res.json({ok:true,type,weight:+w.toFixed(2)});
});

// ── FEED ──────────────────────────────────────────────────────
// /api/feed removed — replaced by /api/region

// ── STORAGE STATUS ────────────────────────────────────────────
app.get('/api/status', (req,res)=>{
  const used=dirSize(NEWS_DATA);
  res.json({
    storage_used_gb:+(used/1e9).toFixed(3),
    storage_max_gb:10,
    storage_pct:+((used/MAX_BYTES)*100).toFixed(1),
    news_count:dbAll('SELECT COUNT(*) as c FROM news')[0]?.c||0,
  });
});

// ── REAPER ────────────────────────────────────────────────────
cron.schedule('*/15 * * * *',()=>{
  const cutoff=Math.floor(Date.now()/1000)-PURGE_TTL;
  const stale=dbAll('SELECT id FROM news WHERE created_at<?',[cutoff]);
  if(!stale.length) return;
  for(const {id} of stale){
    try{dbRun('DELETE FROM votes WHERE news_id=?',[id]);}catch{}
    try{dbRun('DELETE FROM news WHERE id=?',[id]);}catch{}
    deleteNewsDir(id);
  }
  log.info(`REAPER: purged ${stale.length} expired items`);
});

// ── BOOT ──────────────────────────────────────────────────────
initDB().then(()=>{
  let rebuilt=0;
  if(fs.existsSync(NEWS_DATA)){
    for(const id of fs.readdirSync(NEWS_DATA)){
      const meta=readMeta(id); if(!meta) continue;
      const exists=dbGet('SELECT id FROM news WHERE id=?',[meta.id]);
      if(!exists){
        try{
          dbRun(
            `INSERT INTO news (id,owner_id,title,description,lat,lon,gh_chunk,gh_sub,gh_cell,links,image_count,thumb,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [meta.id,meta.owner_id,meta.title,meta.description||'',
             meta.lat,meta.lon,meta.gh_chunk,meta.gh_sub,meta.gh_cell||null,
             meta.links||'',meta.image_count||0,(meta.images||[])[0]||'',meta.created_at]
          );
          rebuilt++;
        }catch(e){log.error('REBUILD',id,e.message);}
      }
    }
  }
  if(rebuilt) log.info(`Boot: rebuilt ${rebuilt} entries`);
  app.listen(PORT,()=>{
    log.info(`জনতার বার্তা → http://localhost:${PORT}`);
    log.info(`Storage: ${(dirSize(NEWS_DATA)/1e6).toFixed(1)} MB used`);
  });
}).catch(e=>{console.error('FATAL:',e);process.exit(1);});

module.exports = app; // required for Vercel
