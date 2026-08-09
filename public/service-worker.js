const CACHE="cardvault-v103-shell";
const SHELL=["/","/index.html","/styles.css","/app.js","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png","/icons/card-placeholder.svg"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin || url.pathname.startsWith("/api/"))return;

  event.respondWith(
    fetch(request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(request,copy));
      return response;
    }).catch(()=>caches.match(request).then(hit=>hit||caches.match("/")))
  );
});
