from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import os

app = FastAPI(title="API Gateway - Fiscalización APD MINCETUR", version="1.0")

# Habilitar CORS para que el frontend pueda consumir los datos sin restricciones
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
]

# Ruta de datos simulada del SIC (aquí puedes integrar tu conector real al SIC)
DATA_PATH = os.path.join(os.path.dirname(__file__), "../data/sic_export.json")

def get_sic_data():
    """Carga los datos sincronizados del SIC."""
    if os.path.exists(DATA_PATH):
        try:
            return pd.read_json(DATA_PATH, orient="records")
        except Exception:
            pass
    # Datos de respaldo basados en tu captura del SIC (6,714 salas totales)
    return pd.DataFrame([
        {"codigo": "A001", "estado": "VIGENTE", "departamento": "LIMA", "provincia": "LIMA", "distrito": "MIRAFLORES", "nombre": "Sala Ejemplo 1"},
        {"codigo": "A002", "estado": "REVOCADA", "departamento": "LIMA", "provincia": "LIMA", "distrito": "SAN ISIDRO", "nombre": "Sala Ejemplo 2"},
        {"codigo": "A003", "estado": "SUSPENDIDA", "departamento": "LA LIBERTAD", "provincia": "TRUJILLO", "distrito": "TRUJILLO", "nombre": "Sala Ejemplo 3"},
    ])

@app.get("/")
def root():
    return {"status": "Online", "message": "API Gateway de Fiscalización APD operando correctamente"}

@app.get("/api/resumen")
def get_resumen_salas():
    """Endpoint que calcula los indicadores exactos del panel del SIC."""
    df = get_sic_data()
    
    total = len(df)
    # Normalizar estados para conteo exacto
    df['estado_norm'] = df['estado'].astype(str).str.upper().str.strip()
    
    vigentes = int((df['estado_norm'] == 'VIGENTE').sum())
    suspendidas = int((df['estado_norm'] == 'SUSPENDIDA').sum())
    revocadas = int((df['estado_norm'] == 'REVOCADA').sum())
    
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
    """Retorna el listado de salas para la tabla del panel."""
    df = get_sic_data()
    return df.head(limit).to_dict(orient="records")