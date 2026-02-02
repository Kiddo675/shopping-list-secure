const CACHE = "shoppinglist-secure-v2"; // Version hochsetzen!
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Install: precache nur eigene Assets
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: alte Caches löschen
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: nur SAME-ORIGIN cache-first, alles andere network-only
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Alles externe (Supabase, cdn.jsdelivr, etc.) -> direkt Netzwerk
  if (url.origin !== self.location.origin) {
    return; // Browser macht normal fetch, SW mischt sich nicht ein
  }

  // Nur GET Requests cachen
  if (e.request.method !== "GET") {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => {
      return (
        hit ||
        fetch(e.request).then((res) => {
          // Erfolgreiche Responses in Cache speichern
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
      );
    })
  );
});
