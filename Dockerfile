FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# threaded sync workers — streaming holds the connection open per request,
# so we want lots of threads available
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "16", \
     "--timeout", "120", "--access-logfile", "-", "app:app"]
