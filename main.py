from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import os

app = FastAPI(title="Panel Fiscalizacion APD", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar archivos estáticos para la interfaz web
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

DATA_PATH = os.path.join(os.path.dirname(__file__), "data/sic_export.json")

def get_sic_data():
    if os.path.exists(DATA_PATH):
        try:
            return pd.read_json(DATA_PATH, orient="records")
        except Exception:
            pass
    return pd.DataFrame([
        {"codigo": "A001", "estado": "VIGENTE", "departamento": "LIMA", "provincia": "LIMA", "distrito": "MIRAFLORES", "nombre": "Sala Ejemplo 1"},
        {"codigo": "A002", "estado": "REVOCADA", "departamento": "LIMA", "provincia": "LIMA", "distrito": "SAN ISIDRO", "nombre": "Sala Ejemplo 2"},
        {"codigo": "A003", "estado": "SUSPENDIDA", "departamento": "LA LIBERTAD", "provincia": "TRUJILLO", "distrito": "TRUJILLO", "nombre": "Sala Ejemplo 3"},
    ])

@app.get("/", response_class=HTMLResponse)
def root():
    html_path = os.path.join("static", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h3>Panel operativo encendido. Falta index.html en /static</h3>"

@app.get("/api/resumen")
def get_resumen_salas():
    df = get_sic_data()
    total = len(df)
    df["estado_norm"] = df["estado"].astype(str).str.upper().str.strip()
    
    vigentes = int((df["estado_norm"] == "VIGENTE").sum())
    suspendidas = int((df["estado_norm"] == "SUSPENDIDA").sum())
    revocadas = int((df["estado_norm"] == "REVOCADA").sum())
    
    return {
        "total_salas": total,
        "vigentes": vigentes,
        "porcentaje_vigentes": round((vigentes / total * 100), 1) if total > 0 else 0,
        "suspendidas": suspendidas,
        "porcentaje_suspendidas": round((suspendidas / total * 100), 1) if total > 0 else 0,
        "revocadas": revocadas,
        "porcentaje_revocadas": round((revocadas / total * 100), 1) if total > 0 else 0,
    }

@app.get("/api/salas")
def get_listado_salas(limit: int = 100):
    df = get_sic_data()
    return df.head(limit).to_dict(orient="records")

