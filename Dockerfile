# One image with everything: the client is built with Node, then served by the Python
# server (which also runs the game over WebSockets). Used by Render (render.yaml); works
# with any Docker host.
#
#   docker build -t cardgame .
#   docker run -p 8000:8000 cardgame     # then open http://localhost:8000

# ---- 1. build the client (client/dist)
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. the server, serving the built client
FROM python:3.13-slim
WORKDIR /app/server
# Dependencies straight from pyproject.toml, so the list lives in one place.
COPY server/pyproject.toml ./
RUN python -c "import subprocess, sys, tomllib; deps = tomllib.load(open('pyproject.toml', 'rb'))['project']['dependencies']; subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--no-cache-dir', *deps])"
COPY server/ ./
# The server finds these next to itself: ../client/dist, ../client/public/art and /music.
COPY --from=client /app/client/dist /app/client/dist
COPY client/public/art /app/client/public/art
COPY client/public/music /app/client/public/music

# Render tells the app which port to use in $PORT; 8000 otherwise.
ENV PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
# --proxy-headers: behind Render's HTTPS proxy, trust its forwarded scheme and client IP.
CMD ["sh", "-c", "exec uvicorn net.app:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
