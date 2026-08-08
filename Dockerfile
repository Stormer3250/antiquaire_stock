# Démo web (VPS). Sur le Mac du bar, c'est scripts/setup.sh qui installe le service.
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
# -e : le paquet reste dans /app/src, donc main.py retrouve /app/static à côté.
RUN pip install --no-cache-dir -e .
COPY static ./static

ENV ANTIQUAIRE_DATA_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "--factory", "antiquaire.main:create_app", "--host", "0.0.0.0", "--port", "8000"]
