# Relais « places libres »

Le dataset ouvert répond par oui ou non : _ce train avait-il une place MAX au
moment de l'export ?_ Il ne dit jamais **combien**. Cette information existe,
elle est affichée par le MAX Planner officiel, et elle change tout : entre un
train à 52 places et un train à 2, on ne réserve pas avec la même urgence.

Ce petit service va la chercher. Sans lui, le site fonctionne exactement comme
avant : le nombre de places est un bonus, pas une dépendance.

## Pourquoi un relais, et pas un simple `fetch`

Le service de SNCF (`/api/public/refdata/search-freeplaces-proposals`) est
protégé par un anti-bot. Trois constats, vérifiés :

| Appelant                                                | Résultat |
| ------------------------------------------------------- | -------- |
| `wget`, `curl`, un client HTTP quelconque               | `403`    |
| Un vrai Firefox, depuis une autre origine, sans session | `403`    |
| Une page du MAX Planner déjà chargée                    | `200`    |

Le CORS est pourtant grand ouvert (`Access-Control-Allow-Origin` renvoie
l'origine demandée) : ce n'est donc pas le navigateur qui bloque, c'est
l'absence de session. Il n'y a pas moyen de contourner cela depuis un site
statique, d'où ce relais qui tient la session pour vous.

## Ce qu'il fait

1. Ouvre une page du MAX Planner dans Firefox et la garde ouverte.
2. Rejoue les appels **depuis le contexte de cette page** : même origine, même
   empreinte, exactement les requêtes que le site officiel émet lui-même.
3. Met en cache 20 minutes et sérialise les appels : quelques dizaines de dates
   par visiteur, jamais une moisson.

Si la session tombe (403), la page est jetée et rouverte à la requête suivante.

## Mise en route

```sh
cd ops/freeplaces-relay
npm install
npx playwright install firefox
node relay.js                    # 127.0.0.1:8099
```

Puis, à la construction du site :

```sh
VITE_FREEPLACES_RELAY=https://relais.exemple.fr npm run build
```

Variables : `PORT`, `HOST`, `ALLOW_ORIGIN` (par défaut `*`, à restreindre au
domaine du site en production), `TTL_MINUTES`.

## Format

Le relais est transparent : il rend la réponse du service telle quelle.

```
GET /search-freeplaces-proposals?origin=FRPLY&destination=FRLPD
    &departureDateTime=2026-09-07T00:00:00.000Z
```

```json
{
  "proposals": [
    {
      "num": "6641",
      "count": 52,
      "dep": "2026-09-07T06:20",
      "arr": "2026-09-07T08:22",
      "orig": "PARIS - GARE DE LYON - HALL 1 & 2",
      "dest": "LYON PART DIEU",
      "space": "ASSIS",
      "type": "INOUI"
    }
  ],
  "ratio": 0.32
}
```

`count` est le nombre de places MAX restantes sur le train, `ratio` la part des
trains de la journée ouverts au MAX. Les codes gares (`FRPLY`) sont ceux que le
dataset ouvert publie déjà dans `origine_iata` / `destination_iata` : les deux
sources parlent le même langage, aucune table de correspondance n'est requise.

## À garder en tête

- C'est un service interne de SNCF, pas une API publique contractuelle : il peut
  changer ou disparaître sans préavis. Le site est écrit pour continuer à
  fonctionner ce jour-là.
- Un relais ouvert à tous est un relais que d'autres utiliseront. En production,
  restreignez `ALLOW_ORIGIN` et placez-le derrière votre reverse proxy habituel.
- Firefox est nécessaire : les moteurs Chromium pilotés sont détectés et
  reçoivent un challenge, là où Firefox passe.
