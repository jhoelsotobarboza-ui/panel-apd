"""Panel Fiscalizacion APD.

La extension "Puente SIC - Panel APD" envia a las 8:00 y 17:00 (POST /api/ingest) una
copia de los datos que usa el dashboard de dgjcmt-apd.com: las respuestas de su API
(formularios y marcadores) y el Excel de SIC Consultas. El panel guarda esa copia y
la sirve en las mismas rutas /api/... para que static/dashboard.js dibuje las mismas
graficas. El acceso al panel esta protegido con contrasena (PANEL_PASSWORD).

Variables de entorno:
  PANEL_PASSWORD  contrasena para entrar al panel (obligatoria)
  INGEST_KEY      clave secreta que usa la extension para enviar datos (obligatoria)
  SESSION_SECRET  firma de la cookie de sesion (opcional; por defecto se deriva)
  DATABASE_URL    Postgres donde se guarda la ultima copia (recomendado: en el plan gratuito
                  de Render el disco se borra al reiniciar; sin esto se usa DATA_DIR)
  DATA_DIR        carpeta donde se guarda la ultima copia si no hay DATABASE_URL (por defecto ./data)
"""
import asyncio
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
SNAPSHOT_PATH = os.path.join(DATA_DIR, "snapshot.json.gz")
def _clean_db_url(raw: str) -> str:
    # Tolera lo que suele pegarse desde Neon/Render: "psql 'postgresql://...'", comillas o "DATABASE_URL=".
    url = raw.strip()
    url = re.sub(r"^(DATABASE_URL\s*=\s*)", "", url)
    url = re.sub(r"^psql\s+", "", url)
    return url.strip().strip("'\"").strip()


_DB_RAW = _clean_db_url(os.environ.get("DATABASE_URL", ""))
_m = re.search(r"postgres(?:ql)?://\S+", _DB_RAW)
# Solo se usa si es una direccion de Postgres; cualquier otro valor se ignora (se usa el disco) y se avisa.
DATABASE_URL = _m.group(0).rstrip("'\"") if _m else ""
DATABASE_URL_INVALIDA = bool(_DB_RAW) and not DATABASE_URL

PANEL_PASSWORD = os.environ.get("PANEL_PASSWORD", "")
INGEST_KEY = os.environ.get("INGEST_KEY", "")
SESSION_SECRET = (
    os.environ.get("SESSION_SECRET")
    or hashlib.sha256(("panel-apd|" + PANEL_PASSWORD + "|" + INGEST_KEY).encode()).hexdigest()
).encode()
SESSION_COOKIE = "panel_apd"
SESSION_HOURS = 12
MAX_INGEST_BYTES = 150 * 1024 * 1024

app = FastAPI(title="Panel Fiscalizacion APD", version="2.0", docs_url=None, redoc_url=None, openapi_url=None)


# ---------- Copia de datos enviada por la extension ----------

_cache = {"version": None, "data": None, "checked": 0.0}
# Ultimo error de la base de datos (se muestra en la barra del panel). Si la base falla, se usa el disco.
_db_error = {"msg": None}
if DATABASE_URL_INVALIDA:
    _db_error["msg"] = ("DATABASE_URL no es una direccion de Postgres (debe empezar con postgresql://); "
                        "se ignora y se guarda en disco, que Render borra al reiniciar.")


def _db():
    import psycopg  # solo se usa si hay DATABASE_URL
    conn = psycopg.connect(DATABASE_URL, autocommit=True, connect_timeout=8)
    conn.execute("CREATE TABLE IF NOT EXISTS panel_snapshot (id INT PRIMARY KEY, version TEXT NOT NULL, data BYTEA NOT NULL)")
    return conn


def _db_failed(exc: Exception):
    msg = (type(exc).__name__ + ": " + str(exc)).replace(DATABASE_URL, "<DATABASE_URL>") if DATABASE_URL else str(exc)
    msg = re.sub(r"://[^@\s]*@", "://***@", msg)[:300]
    _db_error["msg"] = msg
    print("[panel-apd] Error con DATABASE_URL, se usa el disco:", msg, flush=True)


def api_key(path_and_query: str) -> str:
    """Clave de una respuesta: ruta + query tal como la arma el dashboard, sin el parametro _t (anti-cache)."""
    if "?" not in path_and_query:
        return path_and_query
    path, query = path_and_query.split("?", 1)
    query = "&".join(p for p in query.split("&") if p and not p.startswith("_t="))
    return path + ("?" + query if query else "")


def _disk_load():
    try:
        mtime = os.path.getmtime(SNAPSHOT_PATH)
    except OSError:
        return None
    if _cache["version"] != mtime:
        with gzip.open(SNAPSHOT_PATH, "rt", encoding="utf-8") as f:
            _cache["data"] = json.load(f)
        _cache["version"] = mtime
    return _cache["data"]


def _disk_save(blob: bytes):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = SNAPSHOT_PATH + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, SNAPSHOT_PATH)


def load_snapshot():
    """Ultima copia recibida. Se conserva hasta que llegue otra, aunque pasen dias sin envios."""
    if not DATABASE_URL:
        return _disk_load()
    # Se revisa la version en la base como maximo cada 30 s; el contenido solo se baja si cambio.
    # Tras un fallo tambien se espera 30 s antes de reintentar, para no demorar cada pagina.
    if time.time() - _cache["checked"] < 30 and (_cache["data"] is not None or _db_error["msg"]):
        return _cache["data"]
    try:
        with _db() as conn:
            row = conn.execute("SELECT version FROM panel_snapshot WHERE id = 1").fetchone()
            if row and row[0] != _cache["version"]:
                blob = conn.execute("SELECT data FROM panel_snapshot WHERE id = 1").fetchone()[0]
                _cache["data"] = json.loads(gzip.decompress(bytes(blob)))
                _cache["version"] = row[0]
        _db_error["msg"] = None
    except Exception as exc:
        _db_failed(exc)
        if _cache["data"] is None:
            _disk_load()
    _cache["checked"] = time.time()
    return _cache["data"]


def save_snapshot(data: dict):
    blob = gzip.compress(json.dumps(data, ensure_ascii=False).encode("utf-8"))
    if DATABASE_URL:
        try:
            with _db() as conn:
                conn.execute(
                    "INSERT INTO panel_snapshot (id, version, data) VALUES (1, %s, %s) "
                    "ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, data = EXCLUDED.data",
                    (data["id"], blob),
                )
            _db_error["msg"] = None
            _cache.update(version=data["id"], data=data, checked=time.time())
            return
        except Exception as exc:
            _db_failed(exc)
    _disk_save(blob)
    _cache.update(version=os.path.getmtime(SNAPSHOT_PATH), data=data, checked=time.time())


# ---------- Sesion ----------

def sign(value: str) -> str:
    return hmac.new(SESSION_SECRET, value.encode(), hashlib.sha256).hexdigest()


def make_session() -> str:
    exp = str(int(time.time()) + SESSION_HOURS * 3600)
    return exp + "." + sign(exp)


def has_session(request: Request) -> bool:
    raw = request.cookies.get(SESSION_COOKIE, "")
    exp, _, sig = raw.partition(".")
    if not exp.isdigit() or not hmac.compare_digest(sig, sign(exp)):
        return False
    return int(exp) > time.time()


# ---------- Paginas ----------

LOGIN_HTML = """<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Panel APD - Ingresar</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f2f4f8;font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#14213d}
form{background:#fff;border:1px solid #dde2ea;border-radius:12px;padding:28px 26px;width:min(340px,calc(100vw - 32px));box-shadow:0 4px 18px rgba(20,33,61,.08)}
h1{font-size:19px;margin:0 0 4px}p{margin:0 0 18px;color:#56627a;font-size:13px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c3cad6;border-radius:6px;font:inherit}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:6px;background:#2457a7;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:#b4232a;font-size:13px;margin-top:12px}
</style></head><body>
<form method="post" action="/login">
<h1>Panel ejecutivo de fiscalizacion</h1><p>Salas APD</p>
<label for="pw">Contrasena</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Ingresar</button>__ERR__
</form></body></html>"""


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if has_session(request):
        return RedirectResponse("/", status_code=303)
    err = "" if PANEL_PASSWORD else '<div class="err">El panel no tiene contrasena configurada (PANEL_PASSWORD).</div>'
    return LOGIN_HTML.replace("__ERR__", err)


@app.post("/login")
async def login(request: Request):
    form = parse_qs((await request.body()).decode("utf-8", "replace"))
    password = (form.get("password") or [""])[0]
    if not PANEL_PASSWORD or not hmac.compare_digest(password.encode(), PANEL_PASSWORD.encode()):
        await asyncio.sleep(1)
        return HTMLResponse(LOGIN_HTML.replace("__ERR__", '<div class="err">Contrasena incorrecta.</div>'), status_code=401)
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie(SESSION_COOKIE, make_session(), max_age=SESSION_HOURS * 3600, httponly=True,
                    secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https",
                    samesite="lax")
    return resp


@app.get("/logout")
def logout():
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie(SESSION_COOKIE)
    return resp


@app.get("/", response_class=HTMLResponse)
def root(request: Request):
    if not has_session(request):
        return RedirectResponse("/login", status_code=303)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"), headers={"Cache-Control": "no-store"})


@app.get("/static/dashboard.js")
def dashboard_js(request: Request):
    if not has_session(request):
        raise HTTPException(401)
    return FileResponse(os.path.join(STATIC_DIR, "dashboard.js"), media_type="application/javascript",
                        headers={"Cache-Control": "no-store"})


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ---------- Datos para el dashboard ----------

@app.get("/api/estado")
def estado(request: Request):
    if not has_session(request):
        raise HTTPException(401)
    snap = load_snapshot()
    sic = (snap or {}).get("sic") or {}
    if not snap or not (snap.get("api") or sic.get("b64")):
        return {"datos": False, "error_base": _db_error["msg"], "intento": (snap or {}).get("ultimo_intento")}
    return {
        "intento": snap.get("ultimo_intento"),
        "datos": True,
        "error_base": _db_error["msg"],
        "recibido": snap.get("received"),
        "api_at": snap.get("api_at"),
        "sic_at": sic.get("at"),
        "sic_ok": bool(sic.get("b64")),
        "sic_error": sic.get("error"),
        "respuestas": len(snap.get("api") or {}),
        "errores": snap.get("errors") or [],
    }


@app.get("/api/sic")
def sic(request: Request):
    if not has_session(request):
        raise HTTPException(401)
    snap = load_snapshot() or {}
    s = snap.get("sic") or {}
    if not s.get("b64"):
        return JSONResponse({"ok": False, "error": s.get("error") or "sin_datos",
                             "message": s.get("message") or "La extension aun no ha enviado el Excel de SIC Consultas."})
    return {"ok": True, "b64": s["b64"], "at": s.get("at"), "susp": s.get("susp")}


@app.get("/api/{path:path}")
def api_replay(path: str, request: Request):
    # El dashboard pide estas rutas igual que en dgjcmt-apd.com; se responden con la ultima copia recibida.
    if not has_session(request):
        raise HTTPException(401)
    if not (path.startswith("forms/") or path.startswith("marcadores/")):
        raise HTTPException(404)
    snap = load_snapshot()
    if not snap:
        raise HTTPException(503, "Sin datos todavia")
    key = api_key("/api/" + path + ("?" + request.url.query if request.url.query else ""))
    body = (snap.get("api") or {}).get(key)
    if body is None:
        raise HTTPException(404, "No hay copia de " + key)
    return Response(body, media_type="application/json", headers={"Cache-Control": "no-store"})


# ---------- Recepcion desde la extension ----------

@app.post("/api/ingest")
async def ingest(request: Request):
    sent = request.headers.get("x-ingest-key", "")
    if not INGEST_KEY or not hmac.compare_digest(sent.encode(), INGEST_KEY.encode()):
        raise HTTPException(401, "Clave de envio invalida")
    raw = await request.body()
    if len(raw) > MAX_INGEST_BYTES:
        raise HTTPException(413)
    if request.headers.get("content-encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "JSON invalido")

    api = payload.get("api")
    if not isinstance(api, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in api.items()):
        raise HTTPException(400, "Falta el bloque api")
    api = {api_key(k): v for k, v in api.items() if re.match(r"^/api/(forms|marcadores)/", k)}

    old = load_snapshot() or {}
    sic_in = payload.get("sic") or {}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    errors = [str(e)[:300] for e in (payload.get("errors") or [])][:20]
    intento = {"at": now, "errores": errors, "nuevo": bool(api or sic_in.get("b64"))}

    if not intento["nuevo"]:
        # La extension no consiguio datos nuevos: solo se registra el intento y se conservan las cifras guardadas.
        snap = dict(old) if old else {"api": {}, "sic": {}}
        snap.update(ultimo_intento=intento, id=secrets.token_hex(6))
        save_snapshot(snap)
        return {"ok": True, "respuestas": len(snap.get("api") or {}), "sic": bool((snap.get("sic") or {}).get("b64"))}

    if sic_in.get("b64"):
        base64.b64decode(sic_in["b64"], validate=True)
        sic_data = {"b64": sic_in["b64"], "at": sic_in.get("at"), "susp": sic_in.get("susp")}
    else:
        # Si esta vez no se pudo leer SIC (sesion vencida, fuera de la red), se conserva el ultimo Excel.
        sic_data = dict(old.get("sic") or {})
        sic_data["error"] = sic_in.get("error") or "sin_excel"
        sic_data["message"] = sic_in.get("message")

    if not api and old.get("api"):
        api = old["api"]

    snap = {
        "received": now,
        "api_at": payload.get("api_at") if payload.get("api") else old.get("api_at"),
        "api": api,
        "sic": sic_data,
        "errors": errors,
        "ultimo_intento": intento,
        "id": secrets.token_hex(6),
    }
    save_snapshot(snap)
    return {"ok": True, "respuestas": len(api), "sic": bool(sic_data.get("b64"))}
