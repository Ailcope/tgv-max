# tgvmax-alert

Bulletin quotidien des places **MAX JEUNE** sur des trajets suivis, à partir des
[données ouvertes SNCF « tgvmax »](https://ressources.data.sncf.com/explore/dataset/tgvmax/).

Le dataset n'est exporté qu'**une fois par jour**, tôt le matin : le script est prévu pour un
unique passage quotidien (cron à 07:15). À chaque passage il envoie **l'état complet de la
fenêtre glissante** (~30 jours) pour chaque trajet suivi, et marque dedans ce qui a bougé
depuis la veille.

## Ce que dit le bulletin

| Marque | Sens                                                              |
| ------ | ----------------------------------------------------------------- |
| `+`    | Place qui vient de s'ouvrir depuis le dernier passage             |
| `-`    | Place qui a disparu (section dédiée, uniquement sur dates à venir) |
| `⚠`    | Train qui vient de passer sous le seuil de places restantes       |

Deux rendus, parce que les deux canaux n'ont pas les mêmes contraintes :

- **ntfy** reçoit une version compacte, un jour par ligne (`lun 07/09  07:12+ 19:20`). ntfy.sh
  plafonne le corps à ~4 Ko et trente jours détaillés dans les deux sens en font bien plus.
  `ntfy[].max_bytes` relève la limite pour une instance auto-hébergée ; au-delà, le corps est
  coupé à la ligne avec le nombre de lignes manquantes.
- **mail** reçoit le détail complet : numéros de train, heures d'arrivée, disparitions, et
  l'habitude de chaque trajet sur les 60 derniers relevés.

## Configuration

`config.json` à côté du script (voir `config.example.json`). Aucun redémarrage : le cron relit
le fichier à chaque passage.

### `watch[]` — les trajets

```json
{ "name": "Reims -> Sedan", "from": "REIMS", "to": "SEDAN" }
```

- `from` / `to` : le **libellé** SNCF en majuscules (champs `origine` / `destination` du
  dataset), pas le code gare.
- `name` : la clé d'historique. Le renommer repart de zéro sur les statistiques du trajet.
- `weekdays` (optionnel) : `[0]` = lundi … `[6]` = dimanche. **Absent = tous les jours.**
- `after` / `before` (optionnels) : heure de départ, `"HH:MM"`. Absents = toutes les heures.

### Canaux

Tous optionnels — retirer la clé désactive le canal.

- `ntfy` : une cible ou une liste. Auth par `token` (Bearer) **ou** `user` / `password` (Basic).
  L'échec d'une cible ne prive pas les autres.
- `mail` : `relay_url` + `token` + `to`. Passe par un relais HTTP, la machine n'ayant pas de
  sortie SMTP (port 25 bloqué par le FAI).
- `freeplaces` : active les nombres de places et la marque `⚠`. `threshold` (défaut 5) est le
  seuil, `horizon_days` (défaut 14) borne les jours interrogés — le relais est appelé une fois
  par jour et par sens, inutile d'aller chercher J+30.
- `healthcheck_url` / `healthcheck_host` : ping Healthchecks, pour savoir si le cron a tourné.

## Déploiement

```sh
install -m 755 watch.py /opt/tgvmax-alert/watch.py
install -m 600 config.example.json /opt/tgvmax-alert/config.json   # puis remplir les secrets
install -m 644 tgvmax-alert.cron /etc/cron.d/tgvmax-alert
```

`config.json` contient des jetons : il reste en `600`, et n'est pas versionné.

## Utilisation

```sh
python3 /opt/tgvmax-alert/watch.py               # passage réel (écrit state.json, notifie)
python3 /opt/tgvmax-alert/watch.py --historique   # lecture seule, n'envoie rien
```

Le passage manuel **réécrit `state.json`** : il consomme les nouveautés du matin, que le
passage cron suivant ne marquera donc plus d'un `+`.
