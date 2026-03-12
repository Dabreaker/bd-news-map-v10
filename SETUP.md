# জনতার বার্তা — সংবাদ হোক দালাল মুক্ত।

## Termux (Local)
```bash
cd ~/jonatar-barta
npm install
node server.js
# → http://localhost:3000
```

## Vercel (Free Hosting)
```bash
npm install -g vercel
vercel login
vercel deploy --prod
```
Set env vars in Vercel dashboard:
- JWT_SECRET = (random 32+ char string)

Note: On Vercel free tier, storage uses /tmp (resets on cold start).
For persistent storage, add Vercel Blob or Neon PostgreSQL.

## logo.png
Place your logo at the project root as `logo.png` — the app reads `/logo.png`.
Fallback: shows "জ" in a blue circle if missing.

## Features
- ৫০০মি লোড রেডিয়াস — শুধু কাছের সংবাদ লোড
- ৫মি×৫মি ঘর — এক ঘরে একটি সংবাদ
- মার্কার সাইজ = মানচিত্রে আসল ৫মি×৫মি
- ব্রাউজার পাসওয়ার্ড সংরক্ষণ
- ১০ জিবি স্টোরেজ সীমা
- ৩৬ ঘন্টা পরে পুরনো সংবাদ মুছে যায়
