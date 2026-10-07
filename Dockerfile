# Two runtimes at build time, one at runtime (plus the Arduino compiler). Node exists only to turn
# web/ into a static bundle; the shipped image is Python + uvicorn, which
# serves that bundle and the API off a single port (see app/main.py).
#
# Docker rather than Render's native Python runtime on purpose: that
# runtime does ship node, but its version is undocumented and Render
# documents NODE_VERSION as applying to the Node runtime only — while
# Next 16 needs Node 20+. Pinning it here removes the guess.

# ---- stage 1: build the console ----
FROM node:22-bookworm-slim AS web

WORKDIR /web

# Lockfile first, so npm ci stays cached across source-only edits.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

# output: "export" (web/next.config.ts) emits plain static files to
# /web/out. NEXT_PUBLIC_JARVIS_API_URL is deliberately left unset here:
# unset means same-origin, which is exactly right once FastAPI is the
# thing serving this bundle.
RUN npm run build

# ---- stage 2: the Arduino toolchain ----
# arduino-cli, the AVR core and the libraries a workshop sketch may use,
# so the server can compile projects for the emulated UNO
# (app/services/arduino.py). Pinned, so a rebuild compiles the same way.
FROM debian:bookworm-slim AS arduino

ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user \
    ARDUINO_DIRECTORIES_DOWNLOADS=/tmp/arduino-downloads

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://downloads.arduino.cc/arduino-cli/arduino-cli_1.5.1_Linux_64bit.tar.gz \
       | tar -xz -C /usr/local/bin arduino-cli \
    && arduino-cli core update-index \
    && arduino-cli core install arduino:avr@1.8.6 \
    && arduino-cli lib install Servo@1.2.2 Stepper@1.1.3 LiquidCrystal@1.0.7 "Adafruit NeoPixel@1.15.5" \
    && rm -rf /tmp/arduino-downloads

# ---- stage 3: runtime ----
FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
# The workshop's component library, shared with the console (see
# app/tools/workshop_project.py), at the same path relative to app/.
COPY web/src/lib/workshop/parts.json ./web/src/lib/workshop/parts.json

COPY --from=arduino /usr/local/bin/arduino-cli /usr/local/bin/arduino-cli
COPY --from=arduino /opt/arduino /opt/arduino
ENV ARDUINO_DIRECTORIES_DATA=/opt/arduino/data \
    ARDUINO_DIRECTORIES_USER=/opt/arduino/user

# app/main.py resolves the bundle as ../web/out relative to app/, so this
# must land at /srv/web/out to be found.
COPY --from=web /web/out ./web/out

# Render injects PORT; the fallback keeps a plain `docker run` working.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
