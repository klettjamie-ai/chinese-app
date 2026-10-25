// network-first for pages/scripts so fixes arrive promptly; cache fallback offline. GET same-origin only.
const C='hanyu-v2';const F=['./','index.html','app.js?v=2','pinyin.js?v=2','data.js?v=2','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(F)).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('hanyu-')&&x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  const key=r.mode==='navigate'?'./':r;
  e.respondWith(fetch(r).then(n=>{if(n&&n.ok&&n.type==='basic'&&!n.redirected){const cp=n.clone();caches.open(C).then(c=>c.put(key,cp)).catch(()=>{})}return n})
    .catch(()=>caches.match(key).then(m=>m||caches.match(r,{ignoreSearch:true})).then(m=>m||new Response('Offline',{status:503,headers:{'Content-Type':'text/plain'}}))))});
