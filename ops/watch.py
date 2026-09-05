#!/usr/bin/env python3
"""Alerte sur les places MAX JEUNE des trajets suivis (open data SNCF « tgvmax »).

Le dataset n'est exporte qu'une fois par jour, tot le matin : ce script est donc
prevu pour un unique passage quotidien. Il ne notifie que les *changements* par
rapport au dernier passage, pour ne pas repeter la meme liste chaque matin.

Trois changements sont surveilles : une place qui s'ouvre, une place qui
disparait, et un train suivi qui passe sous un seuil de places restantes. Ce
dernier demande un relais vers le service des places libres ; sans lui, les
deux premiers fonctionnent tels quels.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import sys
import urllib.parse
import urllib.request
from email.header import Header
from pathlib import Path

BASE = "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax"
HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
STATE = HERE / "state.json"
TIMEOUT = 30

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

# Deux mois de releves : assez pour dire si un train est habituellement libre,
# assez peu pour que l'etat reste un petit fichier.
HISTORY_MAX = 60


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.load(r)


def quote(value: str) -> str:
    """Litteral chaine ODSQL."""
    return '"' + value.replace('"', '\\"') + '"'


def fetch_trains(origin: str, destination: str) -> list[dict]:
    """Toutes les places MAX ouvertes sur un O/D, sur la fenetre glissante."""
    where = " AND ".join(
        [
            f"origine={quote(origin)}",
            f"destination={quote(destination)}",
            'od_happy_card="OUI"',
        ]
    )
    out: list[dict] = []
    limit = 100
    for offset in range(0, 1000, limit):
        params = urllib.parse.urlencode(
            {
                "where": where,
                "select": "date,train_no,heure_depart,heure_arrivee",
                "order_by": "date",
                "limit": limit,
                "offset": offset,
            }
        )
        results = get_json(f"{BASE}/records?{params}").get("results", [])
        out.extend(results)
        if len(results) < limit:
            break
    return out


def code_pair(origin: str, destination: str) -> tuple[str, str] | None:
    """Le couple de codes gares qui porte l'essentiel du trafic sur un O/D.

    Un libelle de ville couvre plusieurs gares (Paris est FRPLY, FRPMO,
    FRPAZ...) alors que le service des places libres s'interroge gare par gare.
    Une requete agregee donne le couple qui decrit la liaison.
    """
    where = " AND ".join([f"origine={quote(origin)}", f"destination={quote(destination)}"])
    params = urllib.parse.urlencode(
        {
            "where": where,
            "group_by": "origine_iata, destination_iata",
            "select": "origine_iata, destination_iata, count(*) as n",
            "order_by": "n DESC",
            "limit": 1,
        }
    )
    rows = get_json(f"{BASE}/records?{params}").get("results", [])
    if not rows:
        return None
    best = rows[0]
    if not best.get("origine_iata") or not best.get("destination_iata"):
        return None
    return best["origine_iata"], best["destination_iata"]


def free_places(relay: str, origin: str, destination: str, date: str) -> dict[str, int]:
    """Places MAX restantes par numero de train, un jour donne.

    Le dataset ouvert ne dit que « il y avait une place a l'export ». Le
    nombre de places, lui, ne vient que du service du MAX Planner, qui refuse
    les appels exterieurs : on passe par le relais (voir ops/freeplaces-relay).
    """
    params = urllib.parse.urlencode(
        {
            "origin": origin,
            "destination": destination,
            # Le service attend un instant complet ; c'est la date qui compte.
            "departureDateTime": f"{date}T00:00:00.000Z",
        }
    )
    body = get_json(f"{relay.rstrip('/')}/search-freeplaces-proposals?{params}")
    out: dict[str, int] = {}
    for proposal in body.get("proposals") or []:
        number = str(proposal.get("num") or "")
        count = proposal.get("count")
        if number and isinstance(count, int):
            out[number] = count
    return out


def dataset_timestamp() -> str | None:
    try:
        metas = get_json(BASE).get("metas", {}).get("default", {})
        return metas.get("data_processed") or metas.get("modified")
    except Exception:
        return None


def matches(train: dict, rule: dict) -> bool:
    day = dt.date.fromisoformat(train["date"][:10])
    if day.weekday() not in rule["weekdays"]:
        return False
    depart = train["heure_depart"]
    if rule.get("after") and depart < rule["after"]:
        return False
    if rule.get("before") and depart > rule["before"]:
        return False
    return True


def key(rule: dict, train: dict) -> str:
    return "|".join(
        [rule["name"], train["date"][:10], train["train_no"], train["heure_depart"]]
    )


def label(rule: dict, train: dict) -> str:
    day = dt.date.fromisoformat(train["date"][:10])
    return (
        f"{JOURS[day.weekday()]} {day.strftime('%d/%m')} · "
        f"{train['heure_depart']} → {train['heure_arrivee']} "
        f"(n°{train['train_no']}) {rule['from']} → {rule['to']}"
    )


def rfc2047(value: str) -> str:
    """Encode un en-tete non-ASCII (« n° », « → ») pour ntfy."""
    if all(ord(c) < 128 for c in value):
        return value
    return Header(value, "utf-8").encode()


def ntfy_targets(cfg: dict) -> list[dict]:
    """`ntfy` accepte une cible unique ou une liste."""
    raw = cfg.get("ntfy") or []
    targets = [raw] if isinstance(raw, dict) else list(raw)
    return [t for t in targets if t.get("url")]


def notify_ntfy_one(target: dict, title: str, body: str, priority: str, tags: str) -> None:
    headers = {
        # ntfy lit les en-tetes en latin-1 : les titres accentues doivent etre
        # encodes en RFC 2047, sinon le serveur renvoie 400.
        "Title": rfc2047(title),
        "Priority": priority,
        "Tags": tags,
        "Content-Type": "text/plain; charset=utf-8",
    }
    if target.get("token"):  # jeton d'acces ntfy.sh (tk_...)
        headers["Authorization"] = f"Bearer {target['token']}"
    elif target.get("user"):
        auth = base64.b64encode(
            f"{target['user']}:{target.get('password', '')}".encode()
        ).decode()
        headers["Authorization"] = f"Basic {auth}"

    req = urllib.request.Request(
        target["url"], data=body.encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT):
        pass


def notify_ntfy(cfg: dict, title: str, body: str, priority: str, tags: str) -> None:
    """Diffuse a toutes les cibles : l'echec de l'une ne prive pas des autres."""
    for target in ntfy_targets(cfg):
        name = target.get("name") or target["url"]
        try:
            notify_ntfy_one(target, title, body, priority, tags)
        except Exception as exc:
            print(f"ntfy KO [{name}]: {exc}", file=sys.stderr)


def notify_mail(cfg: dict, subject: str, body: str) -> None:
    """La machine n'a aucune sortie SMTP (port 25 bloque par le FAI) : on passe
    par un relais HTTP, qui remet le message a un Postfix local."""
    mail = cfg.get("mail") or {}
    url = mail.get("relay_url")
    if not url:
        return
    payload = {"subject": subject, "body": body}
    if mail.get("to"):
        payload["to"] = mail["to"]
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {mail['token']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        if r.status != 200:
            raise RuntimeError(f"relais HTTP {r.status}")


def ping_healthcheck(cfg: dict, suffix: str = "") -> None:
    url = cfg.get("healthcheck_url")
    if not url:
        return
    # healthchecks filtre sur ALLOWED_HOSTS : en direct sur 127.0.0.1 il faut
    # forcer le Host, sinon la requete repart en 400.
    headers = {}
    if cfg.get("healthcheck_host"):
        headers["Host"] = cfg["healthcheck_host"]
    try:
        req = urllib.request.Request(url + suffix, headers=headers)
        urllib.request.urlopen(req, timeout=10).close()
    except Exception as exc:
        print(f"healthcheck KO: {exc}", file=sys.stderr)


def tightening(
    cfg: dict,
    matched: list[tuple[str, dict, dict]],
    previous_seats: dict[str, int],
) -> tuple[dict[str, int], dict[str, int]]:
    """Places restantes sur les trains suivis, et celles qui viennent de baisser.

    Rend deux dictionnaires : l'etat courant, a reecrire tel quel, et les seuls
    trains qui viennent de passer sous le seuil. La distinction compte : sans
    elle, un train a trois places serait signale tous les matins jusqu'a ce
    qu'il soit plein, et l'alerte perdrait tout son sens.

    Sans relais configure, la fonction ne fait rien : le reste du script marche
    exactement comme avant.
    """
    settings = cfg.get("freeplaces") or {}
    relay = settings.get("relay_url")
    if not relay or not matched:
        return dict(previous_seats), {}
    threshold = int(settings.get("threshold", 5))

    pairs: dict[tuple[str, str], tuple[str, str] | None] = {}
    days: dict[tuple[str, str, str], dict[str, int]] = {}
    seats: dict[str, int] = {}
    tight: dict[str, int] = {}
    for entry_key, rule, train in matched:
        od = (rule["from"], rule["to"])
        # Un echec est memorise comme un resultat vide : sur une panne du
        # relais, on ne le rappelle pas une fois par train suivi. Le relais est
        # un confort, son absence ne prive pas des alertes d'ouverture, qui ne
        # dependent que du dataset.
        if od not in pairs:
            try:
                pairs[od] = code_pair(*od)
            except Exception as exc:
                print(f"codes gares KO [{rule['name']}]: {exc}", file=sys.stderr)
                pairs[od] = None
        pair = pairs[od]
        if not pair:
            continue
        day = (pair[0], pair[1], train["date"][:10])
        if day not in days:
            try:
                days[day] = free_places(relay, *day)
            except Exception as exc:
                print(f"places libres KO [{rule['name']} {day[2]}]: {exc}", file=sys.stderr)
                days[day] = {}
        count = days[day].get(train["train_no"])
        if count is None:
            continue
        seats[entry_key] = count
        # On ne signale que la traversee du seuil, vers le bas. Un train deja
        # signale hier reste sous le seuil aujourd'hui sans etre une nouvelle.
        if 0 < count <= threshold and previous_seats.get(entry_key, threshold + 1) > threshold:
            tight[entry_key] = count
    return seats, tight


def observations(matched: list[tuple[str, dict, dict]], seats: dict[str, int]) -> dict[str, dict]:
    """Ce qu'on a vu ce matin, une ligne par trajet suivi.

    `n` est le nombre de trains qui correspondent a la regle, `s` le nombre de
    places sur le plus juste d'entre eux quand le relais a repondu.
    """
    stats: dict[str, dict] = {}
    for entry_key, rule, _train in matched:
        row = stats.setdefault(rule["name"], {"n": 0, "s": None})
        row["n"] += 1
        count = seats.get(entry_key)
        if count is not None:
            row["s"] = count if row["s"] is None else min(row["s"], count)
    return stats


def update_history(history: dict, stats: dict[str, dict], day: str, rules: list[dict]) -> dict:
    """Ajoute le releve du jour, un seul par date et par trajet.

    Un trajet sans train ce matin merite d'etre enregistre a zero : c'est
    justement ce qui distingue « rarement libre » de « pas encore regarde ».
    Deux passages le meme jour ne comptent qu'une fois, le dernier gagne.
    """
    out = {name: list(points) for name, points in history.items()}
    for rule in rules:
        name = rule["name"]
        seen = stats.get(name, {"n": 0, "s": None})
        points = [p for p in out.get(name, []) if p.get("d") != day]
        points.append({"d": day, "n": seen["n"], "s": seen["s"]})
        out[name] = points[-HISTORY_MAX:]
    return out


def trend(points: list[dict]) -> str:
    """« libre 11 fois sur 14 relevés » : la phrase qui manque a une alerte."""
    if not points:
        return "aucun relevé"
    total = len(points)
    free = sum(1 for p in points if p.get("n"))
    releves = f"{total} relevé{'s' if total > 1 else ''}"
    if not free:
        return f"jamais libre sur {releves}"
    if free == total:
        return f"libre à chaque passage ({releves})"
    return f"libre {free} fois sur {releves}"


def spark(points: list[dict], width: int = 30) -> str:
    """Les derniers relevés en une ligne : une barre par passage, du plus ancien."""
    last = points[-width:]
    if not last:
        return ""
    top = max((p.get("n") or 0) for p in last) or 1
    blocks = "▁▂▃▄▅▆▇█"
    return "".join(
        "·" if not p.get("n") else blocks[min(len(blocks) - 1, (p["n"] * len(blocks) - 1) // top)]
        for p in last
    )


def show_history() -> int:
    """Sortie de `--historique` : ce que le suivi a vu, trajet par trajet."""
    if not STATE.exists():
        print("Aucun état : le script n'a pas encore tourné.")
        return 0
    history = json.loads(STATE.read_text(encoding="utf-8")).get("history", {})
    if not history:
        print("Aucun historique : il se remplit à raison d'un relevé par passage.")
        return 0
    for name in sorted(history):
        points = history[name]
        seats = [p["s"] for p in points if p.get("s") is not None]
        detail = f" · au plus bas : {min(seats)} place(s)" if seats else ""
        print(f"{name}")
        print(f"  {spark(points)}  {trend(points)}{detail}")
    return 0


def main() -> int:
    if "--historique" in sys.argv[1:]:
        return show_history()
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    previous: dict[str, str] = {}
    previous_seats: dict[str, int] = {}
    history: dict[str, list[dict]] = {}
    if STATE.exists():
        saved = json.loads(STATE.read_text(encoding="utf-8"))
        previous = saved.get("seen", {})
        previous_seats = saved.get("seats", {})
        history = saved.get("history", {})

    current: dict[str, str] = {}
    matched: list[tuple[str, dict, dict]] = []
    errors: list[str] = []
    for rule in cfg["watch"]:
        try:
            trains = fetch_trains(rule["from"], rule["to"])
        except Exception as exc:  # une panne du dataset ne doit pas vider l'etat
            errors.append(f"{rule['name']}: {exc}")
            for k, v in previous.items():
                if k.startswith(rule["name"] + "|"):
                    current[k] = v
            continue
        for train in trains:
            if matches(train, rule):
                entry_key = key(rule, train)
                current[entry_key] = label(rule, train)
                matched.append((entry_key, rule, train))

    if errors:
        ping_healthcheck(cfg, "/fail")
        print("ERREUR: " + "; ".join(errors), file=sys.stderr)
        return 1

    today = dt.date.today().isoformat()
    # Une date passee disparait de la fenetre glissante : ce n'est pas une perte.
    gone = {
        k: v
        for k, v in previous.items()
        if k not in current and k.split("|")[1] >= today
    }
    new = {k: v for k, v in current.items() if k not in previous}
    seats, tight = tightening(cfg, matched, previous_seats)
    history = update_history(history, observations(matched, seats), today, cfg["watch"])

    if new or gone or tight:
        lines = []
        if new:
            lines.append("PLACES MAX OUVERTES :")
            lines += [f"  + {v}" for v in sorted(new.values())]
        if gone:
            if lines:
                lines.append("")
            lines.append("PLACES DISPARUES :")
            lines += [f"  - {v}" for v in sorted(gone.values())]
        if tight:
            if lines:
                lines.append("")
            lines.append("PLACES QUI SE RARÉFIENT :")
            lines += [
                f"  ! {current[k]} · {n} place(s) restante(s)"
                for k, n in sorted(tight.items(), key=lambda kv: (kv[1], current[kv[0]]))
            ]
        # Une ouverture ne dit pas si elle est banale ou exceptionnelle sur ce
        # trajet. L'historique repond a la question sans qu'on ait a la poser.
        lines.append("")
        lines.append("HABITUDE DE CES TRAJETS :")
        lines += [
            f"  {name} · {trend(history.get(name, []))}"
            for name in sorted(rule["name"] for rule in cfg["watch"])
        ]
        lines.append("")
        lines.append(f"Export du dataset : {dataset_timestamp() or 'inconnu'}")
        lines.append("Reserver : https://www.sncf-connect.com/")
        body = "\n".join(lines)

        title = []
        if new:
            title.append(f"{len(new)} place(s) MAX")
        if gone:
            title.append(f"{len(gone)} perdue(s)")
        if tight:
            title.append(f"{len(tight)} en tension")
        title = "TGVmax : " + ", ".join(title)

        try:
            notify_ntfy(
                cfg,
                title,
                body,
                # Un train qui se vide se reserve le jour meme : c'est aussi
                # urgent qu'une place qui s'ouvre.
                priority="high" if new or tight else "default",
                tags="steam_locomotive" if new else ("hourglass" if tight else "warning"),
            )
        except Exception as exc:
            print(f"ntfy KO: {exc}", file=sys.stderr)
        try:
            notify_mail(cfg, title, body)
        except Exception as exc:
            print(f"mail KO: {exc}", file=sys.stderr)
        print(body)
    else:
        print(f"Aucun changement ({len(current)} place(s) suivie(s)).")
        for name in sorted(rule["name"] for rule in cfg["watch"]):
            print(f"  {name} · {trend(history.get(name, []))}")

    STATE.write_text(
        json.dumps(
            {
                "updated": dt.datetime.now().isoformat(timespec="seconds"),
                "seen": current,
                "seats": seats,
                "history": history,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    ping_healthcheck(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
