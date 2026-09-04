# ops : surveillance des places MAX

Le site répond à la question « où puis-je aller ? ». Il ne répond pas à
« préviens-moi quand une place s'ouvre sur mon trajet du dimanche soir ».
C'est ce que fait `watch.py` : un passage quotidien sur le dataset, et une
notification **uniquement quand quelque chose change**.

Ces scripts vivent à côté du site, pas dedans : ils tournent sur une machine à
soi (cron, conteneur, Raspberry Pi…) et n'ont aucune dépendance vers le front.
Python 3.9+ et la bibliothèque standard suffisent, il n'y a rien à installer.

## Pourquoi une fois par jour

Le dataset `tgvmax` est exporté une seule fois par jour, tôt le matin. Le
sonder toutes les heures ne révélerait rien de plus et taperait pour rien sur
l'API publique. Un passage vers 7 h du matin suffit, une fois l'export publié.

Corollaire à garder en tête : `od_happy_card = "OUI"` veut dire « il y avait
une place à l'export », pas « il y en a une maintenant ». L'alerte dit où
regarder, la réservation se confirme sur SNCF Connect.

## Mise en route

```sh
cp ops/config.example.json ops/config.json
chmod 600 ops/config.json        # le fichier contient des jetons
$EDITOR ops/config.json
python3 ops/watch.py
```

Puis en cron :

```cron
15 7 * * * root /usr/bin/python3 /opt/tgvmax-alert/watch.py >> /var/log/tgvmax-alert.log 2>&1
```

## Configuration

| Clé | Rôle |
| --- | --- |
| `watch[]` | Les trajets suivis. `from`/`to` sont les libellés **exacts** du dataset (`"PARIS (intramuros)"`), `weekdays` suit `date.weekday()` (0 = lundi, 6 = dimanche). `after`/`before` filtrent l'heure de départ. |
| `ntfy[]` | Une cible ou une liste. Chacune accepte `user`/`password` (Basic) ou `token` (Bearer, pour ntfy.sh). Une cible en panne ne prive pas les autres. |
| `mail` | Optionnel. Poste le message en JSON sur un relais HTTP qui le remet à un serveur mail. Utile quand la machine n'a aucune sortie SMTP, ce qui est le cas derrière la plupart des box (port 25 bloqué). |
| `healthcheck_url` | Optionnel. Ping de fin de passage (healthchecks.io ou équivalent) ; `/fail` est envoyé si le dataset est injoignable. |

`state.json` est écrit à côté du script : c'est lui qui permet de ne notifier
que les différences. Le supprimer provoque une notification de tout ce qui est
ouvert au prochain passage.

## Ce que le script évite

- **Répéter la même liste chaque matin** : seules les places apparues ou
  disparues sont annoncées.
- **Confondre « place perdue » et « date sortie de la fenêtre »** : les dates
  passées disparaissent naturellement du dataset glissant, elles ne sont pas
  comptées comme des places perdues.
- **Vider l'état sur une panne réseau** : si le dataset est injoignable, le
  script sort en erreur en conservant ce qu'il savait, plutôt que d'annoncer la
  disparition de tout.
- **Casser les accents** : ntfy lit ses en-têtes en latin-1 et renvoie 400 sur
  de l'UTF-8 brut, les titres sont donc encodés en RFC 2047.
