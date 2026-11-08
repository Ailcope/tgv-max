# ops : surveillance des places MAX

Le site répond à la question « où puis-je aller ? ». Il ne répond pas à
« préviens-moi quand une place s'ouvre sur mon trajet du dimanche soir ».
C'est ce que fait `watch.py` : un passage quotidien sur le dataset, et un
**bulletin** chaque matin. Il donne l'état complet de la fenêtre glissante
(environ 30 jours) pour chaque trajet suivi, et marque dedans ce qui a bougé
depuis la veille :
- « + » pour une place qui s'ouvre ;
- une place qui disparaît ;
- « ⚠ » pour un train qui passe sous le seuil de places restantes.

Le bulletin complet part par mail (en HTML). La notification ntfy en est une
version compacte, coupée avant la limite de taille de ntfy.

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

## En production (pve1, CT 206)

1. Le code est le clone `/opt/tgvmax/src` (branche `deploy/ailcope`), le même
   qui sert à construire le site.
2. `/opt/tgvmax-alert` est un lien vers `/opt/tgvmax/src/ops` : le cron et le
   journal gardent ce chemin.
3. `config.json` (600) et `state.json` sont dans `ops/`, ignorés par git et
   jamais touchés par un `git pull`.
4. Mettre à jour : `cd /opt/tgvmax/src && git pull --ff-only`. Le site n'est
   pas reconstruit pour autant : nginx sert `dist/`, ignoré par git.
5. Ne vide pas `state.json` : tout serait annoncé comme nouveau au passage
   suivant, et l'historique serait perdu.

## Configuration

| Clé | Rôle |
| --- | --- |
| `watch[]` | Les trajets suivis. `from`/`to` sont les libellés **exacts** du dataset (`"PARIS (intramuros)"`), `weekdays` suit `date.weekday()` (0 = lundi, 6 = dimanche). `after`/`before` filtrent l'heure de départ. |
| `ntfy[]` | Une cible ou une liste. Chacune accepte `user`/`password` (Basic) ou `token` (Bearer, pour ntfy.sh). `max_bytes` (3800 par défaut) coupe le corps avant la limite de ntfy. Une cible en panne ne prive pas les autres. |
| `freeplaces` | Optionnel. `relay_url` pointe le relais « places libres » (voir `ops/freeplaces-relay/`). `threshold` est le nombre de places à partir duquel un train suivi est signalé (5 par défaut). `horizon_days` limite les appels au relais aux N prochains jours (14 par défaut). Sans cette clé, seules les ouvertures et les disparitions sont surveillées. |
| `mail` | Optionnel. Poste le message en JSON sur un relais HTTP qui le remet à un serveur mail. Utile quand la machine n'a aucune sortie SMTP, ce qui est le cas derrière la plupart des box (port 25 bloqué). |
| `healthcheck_url` | Optionnel. Ping de fin de passage (healthchecks.io ou équivalent) ; `/fail` est envoyé si le dataset est injoignable. `healthcheck_host` force l'en-tête `Host` quand le ping passe par l'IP locale du serveur. |

`state.json` est écrit à côté du script : c'est lui qui permet de ne notifier
que les différences. Le supprimer provoque une notification de tout ce qui est
ouvert au prochain passage.

## Ce que le script évite

- **Noyer ce qui a bougé dans la liste du jour** : le bulletin est complet, mais
  les places apparues, disparues ou sous le seuil y sont marquées.
- **Confondre « place perdue » et « date sortie de la fenêtre »** : les dates
  passées disparaissent naturellement du dataset glissant, elles ne sont pas
  comptées comme des places perdues.
- **Vider l'état sur une panne réseau** : si le dataset est injoignable, le
  script sort en erreur en conservant ce qu'il savait, plutôt que d'annoncer la
  disparition de tout.
- **Casser les accents** : ntfy lit ses en-têtes en latin-1 et renvoie 400 sur
  de l'UTF-8 brut, les titres sont donc encodés en RFC 2047.
- **Répéter qu'un train est presque plein** : seule la traversée du seuil est
  signalée. Un train à trois places l'annonce une fois, pas tous les matins
  jusqu'à ce qu'il soit complet.
- **Confondre « rarement libre » et « pas encore regardé »** : un trajet sans
  train est enregistré à zéro dans l'historique, il n'est pas simplement absent.

## Le seuil de places

Une place qui s'ouvre est une bonne nouvelle, mais ce n'est pas le moment le
plus utile : le moment utile, c'est quand le train qui vous arrange passe de
vingt places à trois. Le dataset ouvert ne sait pas le dire, il ne publie
qu'un « oui / non ». Le nombre de places vient du service du MAX Planner, qui
refuse les appels extérieurs et se joint donc par le relais.

C'est un supplément, pas une dépendance : `relay_url` absent, ou relais en
panne, et le script continue d'annoncer les ouvertures et les disparitions.

## L'historique des trajets suivis

Une place qui s'ouvre ne dit pas si elle est banale ou exceptionnelle. Sur un
trajet libre tous les matins, l'alerte est du bruit ; sur un trajet complet
depuis trois semaines, c'est le message qu'on attendait.

Le script enregistre donc un relevé par passage et par trajet suivi, dans
`state.json` : le nombre de trains trouvés, et le creux du jour quand le relais
des places libres répond. Deux mois d'historique sont conservés, à raison d'un
point par jour et par trajet ; deux passages le même jour ne comptent qu'une
fois.

Chaque notification porte alors une ligne par trajet, du genre « libre 11 fois
sur 14 relevés ». Un trajet sans train est enregistré à zéro : c'est ce qui
distingue « rarement libre » de « pas encore regardé ».

Pour consulter l'historique sans déclencher de recherche :

```
python3 watch.py --historique
```

Chaque trajet sort avec une barre par passage, du plus ancien au plus récent,
un point valant « aucune place ce jour-là ».
