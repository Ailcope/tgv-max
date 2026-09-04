#!/usr/bin/env python3
"""Alerte sur les places MAX JEUNE des trajets suivis (open data SNCF « tgvmax »).

Le dataset n'est exporte qu'une fois par jour, tot le matin : ce script est donc
prevu pour un unique passage quotidien. Il ne notifie que les *changements* par
rapport au dernier passage, pour ne pas repeter la meme liste chaque matin.
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


def main() -> int:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    previous = {}
    if STATE.exists():
        previous = json.loads(STATE.read_text(encoding="utf-8")).get("seen", {})

    current: dict[str, str] = {}
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
                current[key(rule, train)] = label(rule, train)

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

    if new or gone:
        lines = []
        if new:
            lines.append("PLACES MAX OUVERTES :")
            lines += [f"  + {v}" for v in sorted(new.values())]
        if gone:
            if lines:
                lines.append("")
            lines.append("PLACES DISPARUES :")
            lines += [f"  - {v}" for v in sorted(gone.values())]
        lines.append("")
        lines.append(f"Export du dataset : {dataset_timestamp() or 'inconnu'}")
        lines.append("Reserver : https://www.sncf-connect.com/")
        body = "\n".join(lines)

        title = []
        if new:
            title.append(f"{len(new)} place(s) MAX")
        if gone:
            title.append(f"{len(gone)} perdue(s)")
        title = "TGVmax : " + ", ".join(title)

        try:
            notify_ntfy(
                cfg,
                title,
                body,
                priority="high" if new else "default",
                tags="steam_locomotive" if new else "warning",
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

    STATE.write_text(
        json.dumps(
            {"updated": dt.datetime.now().isoformat(timespec="seconds"), "seen": current},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    ping_healthcheck(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
