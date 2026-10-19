# Hinter einem TLS-abfangenden Firmen-Proxy das Stammzertifikat optional als Build-Secret übergeben:
#   docker build --secret id=ca,src=/pfad/firmen-ca.pem .

# --- Stufe 1: Web-Oberfläche bauen -------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci
COPY frontend/ ./
RUN npm run build

# --- Stufe 2: Laufzeit (FastAPI + gebaute Oberfläche) -----------------------------------------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MACKFMEA_DATA_DIR=/data \
    MACKFMEA_FRONTEND_DIST=/app/frontend/dist
# DejaVu-Schrift für Umlaute und Sonderzeichen im PDF-Export
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /build/frontend/dist /app/frontend/dist
RUN useradd --system --uid 1000 mackfmea && mkdir -p /data && chown mackfmea /data
USER mackfmea
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
