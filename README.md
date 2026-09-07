**Français** | [English](README.en.md) | [中文](README.zh-CN.md)

# 🚄 TGV MAX Planner

Un site pour **planifier ses voyages avec un abonnement TGV MAX**, construit sur les
[données ouvertes SNCF « tgvmax »](https://ressources.data.sncf.com/explore/dataset/tgvmax/).

Le jeu de données brut liste, pour chaque train des ~30 prochains jours, s'il reste une
**place MAX** (billet à 0 € pour les abonnés MAX JEUNE / MAX SENIOR) — mais il n'est pas
lisible tel quel. Ce site le retourne du point de vue du voyageur, dont l'atout principal
est la **flexibilité** (voyages illimités).

> ⏱️ Les données ne sont **pas temps réel** : la SNCF exporte le jeu de données **une fois
> par jour** (tôt le matin). Une place affichée « OUI » a pu être réservée entre-temps ;
> l'app affiche l'horodatage du dernier export et renvoie vers SNCF Connect pour confirmer.

## Fonctionnalités

| Onglet              | À quoi ça sert                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📅 **Calendrier**   | Carte de chaleur des places MAX sur 30 jours pour un trajet A → B. Clic sur un jour → les trains.                                                                                                                      |
| 🧭 **Où aller ?**  | Destinations avec place MAX **depuis** une gare, ou départs menant **vers** une gare choisie, à une date (aujourd'hui / demain / week-end / 🎲). Affiche la **fréquentation** de chaque gare ; tri « les plus fréquentées » ou « les plus confidentielles ». |
| 🔀 **Correspondances** | Quand le direct est complet : itinéraires en **2 à 4 trains** (jusqu'à 3 correspondances), temps de correspondance réglable, **trains de nuit** 🌙 signalés (arrivée J+1). |
| 🗺️ **Carte**        | Destinations posées sur le **vrai réseau ferré SNCF coloré par vitesse** : les **LGV** ressortent en rose, les lignes classiques en bleu.                                                                              |
| 🔁 **Aller-retour** | Allers-retours dans la journée (temps min. sur place) ou week-ends, places MAX dans les deux sens, filtres horaires, mini-carte de l'axe.                                                                              |
| 🚈 **TER + MAX**    | Trajets porte-à-porte mêlant **places MAX à 0 €** et **trains régionaux payants**, sous un **budget maximum**. Le plafond ne compte que ce que vous payez vraiment : les tronçons couverts par une place MAX sont gratuits. Demande une clé API SNCF (voir plus bas). |

Recherche rapide au clavier : **⌘K / Ctrl+K** (gare de départ, puis destination optionnelle).

## Démarrer

Pré-requis : **Node ≥ 20**. Puis :

```bash
npm install
npm run dev        # serveur de dev (Vite) sur http://localhost:5173
npm run build      # build de production typé -> dist/
npm run preview    # sert le build de production
```

L'API SNCF est ouverte en CORS : le navigateur l'interroge directement, sans backend.

### Scripts

| Script                                      | Rôle                                        |
| ------------------------------------------- | ------------------------------------------- |
| `npm run dev` / `build` / `preview`         | Vite : dev, build de prod, prévisualisation |
| `npm test` / `test:watch` / `test:coverage` | Vitest                                      |
| `npm run typecheck`                         | `tsc --noEmit` (strict)                     |
| `npm run lint` / `lint:fix`                 | ESLint (flat config + typescript-eslint)    |
| `npm run format` / `format:check`           | Prettier                                    |
| `npm run check`                             | typecheck + lint + test (ce que fait la CI) |
| `npm run data:stations` / `data:railnet`    | Régénère les données (voir plus bas)        |

## Architecture

TypeScript strict, **sans framework**, structuré en couches. La règle de dépendance va
**de l'extérieur vers l'intérieur** : `ui` → `services`/`data` → `domain`. Le `domain` et
les `lib` sont purs (aucun accès au DOM ni au réseau), donc trivialement testables ; les
dépendances externes (`fetch`, données) sont **injectées** par le point de composition.

```
src/
  main.ts                 point de composition (câble le graphe de dépendances)
  config.ts               constantes (endpoints, liens)
  app/
    App.ts                coquille : layout, routage par onglets (hash), bandeau fraîcheur
  domain/                 cœur métier — PUR (types + règles, sans DOM/fetch)
    models.ts             Station, Train, DestinationAvailability…
    time.ts               durées (gère le passage de minuit)
    availability.ts       niveaux de heatmap + agrégation par destination
    roundtrip.ts          algos aller-retour jour / week-end
    regional.ts           budget des voyages mixtes MAX + TER (prix payable, tri)
  data/                   accès aux données
    SncfApiClient.ts      client typé OpenDataSoft (fetch injecté, pagination)
    query.ts              construction des clauses ODSQL (pur)
    TgvmaxRepository.ts   requêtes métier -> modèles du domaine
    StationRepository.ts  catalogue des gares (recherche, lookup)
    railNetwork.ts        chargement du GeoJSON réseau ferré (lazy, caché)
    NavitiaApiClient.ts   client typé de l'API SNCF « Navitia » (itinéraires TER + tarifs)
    NavitiaKeyStore.ts    où vit le token SNCF (build-time ou localStorage)
    regionalMapper.ts     Navitia -> domaine (pur : modes, tarifs, repérage des places MAX)
    RegionalRepository.ts croisement Navitia x tgvmax, filtrage par budget
  ui/                     présentation
    dom.ts                helpers DOM typés (el/clear/field/select)
    components/           StationPicker, trains, états, drapeaux
    map/                  MapKit (Leaflet) + railLayer (couleur par vitesse)
    views/                CalendarView, DestinationsView, MapView, RoundtripView, RegionalView
  lib/                    utilitaires transverses (dates, format, texte, monnaie)
  assets/data/            stations.json (généré)
public/railnet.geojson    réseau ferré simplifié (généré)
tests/                    tests unitaires Vitest (miroir de src/)
data/                     scripts Python de génération des données
```

### ADR — pourquoi pas de framework UI ?

La valeur de cette app est dans la **logique métier** (agrégations, calculs de dates,
combinaisons d'allers-retours, couche API) — c'est ce qui bénéficie le plus du typage et
des tests, et c'est couvert par des fonctions pures. Les vues sont peu nombreuses et
majoritairement de la data-viz (dont Leaflet, impératif par nature). Réécrire tout en
JSX aurait ajouté du churn et une dépendance lourde sans bénéfice proportionnel. On garde
donc un rendu DOM direct via un petit helper typé, avec une frontière nette entre logique
(testée) et présentation. Ce choix reste réversible : le `domain`/`data` ne dépend pas de l'UI.

## Tests

Tests unitaires ciblant la logique pure et le contrat de la couche data :

```bash
npm test
```

- `domain/` : durées, niveaux de heatmap, agrégation, algos aller-retour (jour & week-end).
- `lib/` : dates, format, normalisation de texte.
- `data/` : construction d'URL + pagination du client (avec un `fetch` factice injecté),
  builders ODSQL, recherche de gares.

## Mode « TER + MAX » (trains régionaux)

L'onglet 🚈 cherche des trajets qui **mélangent les deux réseaux** : un TER pour rejoindre
la gare TGV, puis un TGV où il reste une place MAX. Comme la place MAX est gratuite, le
**budget maximum** que vous fixez ne s'applique qu'au reste — en pratique, aux TER.

Deux sources sont croisées :

| Source | Ce qu'elle apporte | Clé ? |
| ------ | ------------------ | ----- |
| [API SNCF « Navitia »](https://numerique.sncf.com/startup/api/) | itinéraires TER/Intercités/TGV et **tarifs** | oui, gratuite |
| jeu de données **tgvmax** | quels trains ont encore une **place MAX** | non |

Le rapprochement se fait sur le **numéro de train** : un tronçon grande ligne dont le
numéro apparaît dans l'export tgvmax du jour passe à 0 €, les autres consomment le budget.

### Fournir la clé API

Un token développeur gratuit s'obtient sur
[numerique.sncf.com](https://numerique.sncf.com/startup/api/token-developpeur/). Deux façons
de le fournir :

- **dans l'app** : à coller dans l'encart de l'onglet 🚈. Il reste dans le `localStorage`
  du navigateur et n'est envoyé qu'à l'API SNCF ;
- **au build**, pour un déploiement perso : `VITE_SNCF_API_KEY=<token>` dans un `.env.local`.
  L'encart disparaît alors. ⚠️ Une variable `VITE_*` finit **dans le bundle public** : ne
  faites ça que pour un déploiement privé.

### Limites connues

- Les tarifs viennent de l'API : quand elle n'en renvoie pas pour un tronçon, le total est
  marqué **« prix partiel »** plutôt que sous-estimé en silence. Une case permet de masquer
  ces itinéraires.
- Un tarif couvrant plusieurs tronçons est **réparti à parts égales** entre eux pour
  l'affichage ; le total, lui, reste exact.
- Les places MAX viennent de l'export quotidien : un 0 € affiché peut déjà être parti.

## Régénérer les données

Deux jeux de données statiques sont pré-calculés par des scripts Python (à relancer si la
SNCF met à jour ses données) :

```bash
npm run data:stations   # -> src/assets/data/stations.json
npm run data:railnet    # -> public/railnet.geojson
```

## Sources & limites

- **tgvmax** : disponibilité des places MAX, **maj quotidienne**, fenêtre glissante ~30 j.
- **Gares** : coordonnées + UIC via [trainline-eu/stations](https://github.com/trainline-eu/stations) ;
  **fréquentation** via [frequentation-gares](https://ressources.data.sncf.com/explore/dataset/frequentation-gares/) (jointure UIC).
- **Réseau ferré & vitesses** : [vitesse-maximale-nominale-sur-ligne](https://ressources.data.sncf.com/explore/dataset/vitesse-maximale-nominale-sur-ligne/)
  (géométrie simplifiée Douglas-Peucker). Calque optionnel [OpenRailwayMap](https://www.openrailwaymap.org/).
- **Trains régionaux & tarifs** : [API SNCF (Navitia)](https://numerique.sncf.com/startup/api/),
  clé développeur gratuite requise — voir « Mode TER + MAX ».
- Projet **non officiel**, sans lien avec la SNCF.
