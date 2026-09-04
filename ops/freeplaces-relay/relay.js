#!/usr/bin/env node
/**
 * Relais vers le service « places libres » du MAX Planner officiel.
 *
 * Ce service est le seul à publier le **nombre** de places MAX restantes par
 * train ; le dataset ouvert ne donne qu'un booléen. Il n'est pas documenté
 * comme une API publique et il est protégé par un anti-bot qui refuse tout ce
 * qui ne ressemble pas à un vrai navigateur ; un `fetch` depuis un autre site
 * reçoit un 403, y compris depuis un vrai Chrome.
 *
 * D'où ce relais : il tient une page du MAX Planner ouverte dans Firefox, ce
 * qui suffit à obtenir la session, puis rejoue les appels depuis le contexte de
 * cette page. Même origine, même empreinte, exactement ce que fait le site.
 *
 * Il est volontairement économe : un cache mémoire, une seule page réutilisée,
 * et une file d'attente qui sérialise les appels. Il s'agit de lire quelques
 * dizaines de dates par visiteur, pas de moissonner le service.
 *
 *   node relay.js            # écoute sur 127.0.0.1:8099
 *   PORT=9000 HOST=0.0.0.0 node relay.js
 */

import http from "node:http";
import { firefox } from "playwright";

const PORT = Number(process.env.PORT ?? 8099);
const HOST = process.env.HOST ?? "127.0.0.1";
/** Origines autorisées à appeler le relais ; `*` pour ouvrir à tous. */
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "*";
/** Durée de vie du cache. Les disponibilités bougent, mais pas à la seconde. */
const TTL_MS = Number(process.env.TTL_MINUTES ?? 20) * 60_000;

const PLANNER = "https://www.maxjeune-tgvinoui.sncf/sncf-connect/max-planner";
const ENDPOINT = "/api/public/refdata/search-freeplaces-proposals";
/** Le service ne connaît que des codes gares à cinq lettres, `FRPLY`. */
const CODE = /^[A-Z]{5}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const cache = new Map();
let page = null;
/** Les appels passent l'un après l'autre : une seule page, un seul contexte. */
let queue = Promise.resolve();

const log = (...args) => console.log(new Date().toISOString(), ...args);

/**
 * La page qui porte la session. Recréée à la demande : le navigateur peut
 * mourir, et la session finit de toute façon par expirer.
 */
async function ensurePage() {
  if (page && !page.isClosed()) return page;
  log("ouverture d'une session MAX Planner");
  const browser = await firefox.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: { width: 1280, height: 900 },
  });
  const p = await ctx.newPage();
  await p.goto(PLANNER, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Le challenge anti-bot se résout en arrière-plan, il lui faut ces secondes.
  await p.waitForTimeout(6000);
  page = p;
  return p;
}

/** Un appel au service, depuis le contexte de la page. */
async function fetchProposals(origin, destination, date) {
  const p = await ensurePage();
  const result = await p.evaluate(
    async ([endpoint, o, d, when]) => {
      const url = endpoint + "?origin=" + o + "&destination=" + d + "&departureDateTime=" + when;
      const res = await fetch(url);
      if (!res.ok) return { status: res.status };
      return { status: 200, body: await res.json() };
    },
    [ENDPOINT, origin, destination, `${date}T00:00:00.000Z`],
  );
  if (result.status !== 200) {
    // Un 403 signifie que la session est tombée : on la jette pour que la
    // requête suivante en ouvre une neuve, sinon on reste bloqué en boucle.
    if (result.status === 403) {
      await page
        ?.context()
        .browser()
        ?.close()
        .catch(() => {});
      page = null;
    }
    throw new Error(`service amont ${result.status}`);
  }
  return result.body;
}

/** Le même appel, mais mis en cache et sérialisé. */
function proposals(origin, destination, date) {
  const key = `${origin}|${destination}|${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.body);

  const run = queue.then(async () => {
    // Le cache a pu se remplir pendant l'attente dans la file.
    const again = cache.get(key);
    if (again && Date.now() - again.at < TTL_MS) return again.body;
    const body = await fetchProposals(origin, destination, date);
    cache.set(key, { at: Date.now(), body });
    return body;
  });
  // La file ne doit pas s'arrêter sur un échec.
  queue = run.catch(() => {});
  return run;
}

function send(res, status, body, origin) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": `public, max-age=${Math.floor(TTL_MS / 1000)}`,
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const allow = ALLOW_ORIGIN === "*" ? "*" : ALLOW_ORIGIN;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": allow,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }
  if (url.pathname === "/health")
    return send(res, 200, { healthy: true, cached: cache.size }, allow);
  if (url.pathname !== ENDPOINT && url.pathname !== "/search-freeplaces-proposals") {
    return send(res, 404, { error: "not found" }, allow);
  }

  const origin = (url.searchParams.get("origin") ?? "").toUpperCase();
  const destination = (url.searchParams.get("destination") ?? "").toUpperCase();
  const date = (url.searchParams.get("departureDateTime") ?? "").slice(0, 10);
  if (!CODE.test(origin) || !CODE.test(destination) || !DATE.test(date)) {
    return send(
      res,
      400,
      { error: "origin, destination (codes gares) et departureDateTime requis" },
      allow,
    );
  }

  proposals(origin, destination, date)
    .then((body) => send(res, 200, body, allow))
    .catch((err) => {
      log("échec", origin, destination, date, String(err.message));
      send(res, 502, { error: String(err.message) }, allow);
    });
});

server.listen(PORT, HOST, () => log(`relais places libres sur http://${HOST}:${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close();
    page
      ?.context()
      .browser()
      ?.close()
      .catch(() => {});
    process.exit(0);
  });
}
