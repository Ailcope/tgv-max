/**
 * Service worker : garder le site consultable dans un train sans réseau.
 *
 * Rien n'est pré-chargé à l'installation. Les fichiers du site portent un nom
 * qui change à chaque version : une liste écrite ici serait fausse dès la
 * publication suivante. On garde donc ce qui a réellement servi, et on le rend
 * de nouveau quand le réseau manque.
 *
 * Deux régimes, parce que deux besoins :
 *
 * - **Le site lui-même** (page, scripts, styles, carte du réseau) : le cache
 *   d'abord. Il ne change qu'entre deux versions, et l'attente réseau ne se
 *   justifie pas ; la version fraîche est rangée en arrière-plan pour la fois
 *   suivante.
 * - **Les données SNCF** : le réseau d'abord, le cache en secours. Une place
 *   affichée d'après une réponse d'hier vaut mieux qu'un écran vide, mais on
 *   ne la préfère jamais à la réponse du jour.
 *
 * Ce fichier est servi tel quel : il n'est ni compilé ni transformé.
 */

const VERSION = "v1";
const SHELL = `tgvmax-shell-${VERSION}`;
const DATA = `tgvmax-data-${VERSION}`;

/** Réponses de données gardées, au-delà les plus anciennes sont effacées. */
const DATA_MAX = 60;

self.addEventListener("install", (event) => {
  // La page d'accueil suffit à ouvrir le site hors ligne ; le reste se met en
  // cache au fil de la navigation.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add(new Request("./", { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Borne la taille d'un cache, en effaçant les entrées les plus anciennes. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

/** Réseau d'abord, cache en secours : pour ce qui change tous les jours. */
async function dataFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(DATA);
      await cache.put(request, fresh.clone());
      void trim(DATA, DATA_MAX);
    }
    return fresh;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw err;
  }
}

/** Cache d'abord, réseau en arrière-plan : pour ce qui ne bouge qu'entre versions. */
async function shellFirst(request) {
  const hit = await caches.match(request);
  const update = fetch(request)
    .then(async (fresh) => {
      if (fresh.ok) {
        const cache = await caches.open(SHELL);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    })
    .catch(() => undefined);
  return hit ?? (await update) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Une navigation hors ligne doit rouvrir le site, pas une page d'erreur.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("./")) ?? Response.error()),
    );
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(shellFirst(request));
    return;
  }
  if (url.hostname.endsWith("data.sncf.com")) {
    event.respondWith(dataFirst(request));
  }
  // Tout le reste (tuiles de carte, page Ko-fi) passe sans interception.
});
