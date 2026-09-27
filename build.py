"""Arma el dashboard de la Polla NFL.

Uso:
  python build.py            # mezcla data/snapshot.json en data/store.json y genera index.html
  python build.py --skip     # imprime las semanas cerradas ya guardadas (para window.POLLA_SKIP)

data/snapshot.json es lo que devuelve extract.js en el navegador.
data/store.json es el acumulado: semanas cerradas, piques abiertos conocidos
de cada cuenta e historial diario de posiciones.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SNAPSHOT = ROOT / "data" / "snapshot.json"
STORE = ROOT / "data" / "store.json"
TEMPLATE = ROOT / "template.html"
OUT = ROOT / "index.html"  # lo sirve GitHub Pages

HEAD = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
"""
PANAMA = timezone(timedelta(hours=-5))


def load(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def merge_week(old, new, fetched_at):
    """Conserva piques abiertos que ya no se ven (p. ej. se cambió de cuenta)."""
    if not old:
        return new
    old_games = {g["id"]: g for g in old["games"]}
    for g in new["games"]:
        prev = old_games.get(g["id"])
        if not prev:
            continue
        for who, pick in prev.get("picks", {}).items():
            if who not in g["picks"] and g["lockAt"] > fetched_at:
                g["picks"][who] = pick
    return new


def main():
    store = load(STORE, {"weeks": [], "history": []})

    if "--skip" in sys.argv:
        print(json.dumps([w["n"] for w in store["weeks"] if w["status"] == "settled"]))
        return

    snap = load(SNAPSHOT, None)
    if snap is None:
        sys.exit("No existe data/snapshot.json")
    if snap.get("error"):
        sys.exit("El extractor devolvió un error: " + snap["error"])

    fetched = snap["fetchedAt"]
    by_name = {w["n"]: w for w in store["weeks"]}
    for w in snap["weeks"]:
        by_name[w["n"]] = merge_week(by_name.get(w["n"]), w, fetched)
    store["weeks"] = sorted(by_name.values(), key=lambda w: int(w["n"].split()[-1]))
    store.update({k: snap[k] for k in ("fetchedAt", "contest", "loggedAs", "entries", "standings")})

    # Historial: una foto por día (hora de Panamá) con puesto y récord de cada cuenta.
    day = datetime.fromisoformat(fetched.replace("Z", "+00:00")).astimezone(PANAMA).date().isoformat()
    point = {"d": day, "field": len(snap["standings"])}
    for s in snap["standings"]:
        if s["me"]:
            point[s["h"]] = {"r": s["r"], "dr": s["dr"], "w": s["w"], "l": s["l"]}
    store["history"] = [h for h in store["history"] if h["d"] != day] + [point]

    STORE.write_text(json.dumps(store, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    payload = json.dumps(store, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = TEMPLATE.read_text(encoding="utf-8").replace("/*__POLLA_DATA__*/null", payload)
    # La plantilla empieza con <title>, <link> y <style> (van al head) y sigue con el cuerpo.
    split = page.index("</style>") + len("</style>")
    html = HEAD + page[:split] + "\n</head>\n<body>\n" + page[split:] + "\n</body>\n</html>\n"
    OUT.write_text(html, encoding="utf-8")
    print(f"OK {fetched} · {len(store['weeks'])} semanas · {len(store['standings'])} en la tabla -> {OUT.name}")


if __name__ == "__main__":
    main()
