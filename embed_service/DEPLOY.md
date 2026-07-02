# Embedding Sidecar — Remote Deployment Guide

This guide covers running `embed_service/main.py` on any remote host so the
Semantic Document Search web app can use real Ollama `mxbai-embed-large`
embeddings and a FAISS vector index instead of the built-in n-gram fallback.

---

## How the connection works

The Node.js backend reads the `EMBED_SERVICE_URL` environment variable at
startup. When it is set and the sidecar is reachable, all embed, reindex,
delete, and search operations are routed to the Python sidecar. When it is
empty or the sidecar is unreachable, the app falls back silently to the
built-in character n-gram embedder. The nav bar status badge reflects the
current state in real time.

---

## Option A — Manus Cloud Computer

A Cloud Computer is a persistent Ubuntu 24.04 VM managed by Manus. It is the
recommended option when you want the sidecar to run independently of your
local machine.

### 1. Purchase and attach a Cloud Computer

Purchase a Basic tier ($10/month, 2 vCPU, 2 GB RAM) or higher from your
Manus account settings. The Basic tier is sufficient for `mxbai-embed-large`
(~670 MB model weight).

### 2. Connect to the VM

Manus gives you shell access to the Cloud Computer through the agent. All
commands below run on the Cloud Computer (prefix your shell session with the
cloud computer identifier).

### 3. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull mxbai-embed-large
```

Enable Ollama as a system service so it starts on boot:

```bash
sudo systemctl enable ollama
sudo systemctl start ollama
```

### 4. Copy the sidecar files

Upload `embed_service/` to the Cloud Computer, or clone your repository:

```bash
git clone <your-repo-url> semantic-doc-search
cd semantic-doc-search/embed_service
```

### 5. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 6. Install the systemd service

```bash
sudo tee /etc/systemd/system/embed-sidecar.service > /dev/null << 'EOF'
[Unit]
Description=Semantic Search Embedding Sidecar
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/semantic-doc-search/embed_service
ExecStart=/home/ubuntu/semantic-doc-search/embed_service/.venv/bin/python main.py
Restart=always
RestartSec=5
Environment=OLLAMA_BASE_URL=http://localhost:11434
Environment=EMBED_MODEL=mxbai-embed-large
Environment=SIDECAR_PORT=8765
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable embed-sidecar
sudo systemctl start embed-sidecar
```

### 7. Open the firewall port

```bash
sudo ufw allow 8765/tcp
sudo ufw reload
```

### 8. Get the public IP

```bash
curl -s ifconfig.me
```

### 9. Set EMBED_SERVICE_URL in the web app

In the Manus WebDev Management UI → Settings → Secrets, set:

```
EMBED_SERVICE_URL = http://<YOUR_CLOUD_COMPUTER_IP>:8765
```

Or use the Secrets card in the chat to update it. The web app will pick up
the new value on the next request without a restart.

---

## Option B — Any VPS (DigitalOcean, Hetzner, AWS EC2, etc.)

The steps are identical to Option A. The only differences are:

- You manage the VM yourself (SSH key setup, OS updates, billing).
- Make sure port 8765 is open in your cloud provider's firewall/security group.
- Consider putting the sidecar behind nginx with TLS if the traffic is
  sensitive, and restrict access to the web app's IP only.

---

## Option C — Local machine

If you run the web app locally (via `pnpm dev`) and also have Ollama installed
on the same machine, simply start the sidecar and set the URL:

```bash
cd embed_service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py          # listens on http://localhost:8765
```

In your `.env.local` (project root):

```
EMBED_SERVICE_URL=http://localhost:8765
```

---

## Environment variables for the sidecar

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Base URL of the Ollama server |
| `EMBED_MODEL` | `mxbai-embed-large` | Ollama model name for embeddings |
| `SIDECAR_PORT` | `8765` | Port the FastAPI server listens on |
| `FAISS_INDEX_DIR` | `./faiss_index` | Directory where the FAISS index is persisted |
| `CHUNK_SIZE` | `500` | Characters per chunk |
| `CHUNK_OVERLAP` | `100` | Overlap between consecutive chunks |

---

## Verifying the connection

Once running, visit `http://<HOST>:8765/docs` for the interactive API explorer,
or check health directly:

```bash
curl http://<HOST>:8765/health
```

Expected response:

```json
{
  "status": "ok",
  "model": "mxbai-embed-large",
  "dim": 1024,
  "chunk_size": 500,
  "chunk_overlap": 100,
  "indexed": 0,
  "documents": 0
}
```

The nav bar badge in the web app will turn green and show the model name
within 30 seconds of the sidecar becoming reachable.

---

## Re-indexing existing documents

Documents indexed before the sidecar was connected used the n-gram fallback.
To upgrade them to real Ollama embeddings, go to the **Documents** page and
click the **Re-index** (↻) button on each document, or use the bulk-select
toolbar to re-index many at once.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Badge stays amber after setting URL | Firewall blocking port 8765 | `sudo ufw allow 8765/tcp` |
| `Connection refused` in logs | Sidecar not started | `sudo systemctl start embed-sidecar` |
| `model not found` error in sidecar logs | Model not pulled | `ollama pull mxbai-embed-large` |
| Slow first embed after restart | Ollama loading model into RAM | Wait ~10 s; subsequent calls are fast |
| FAISS index lost after restart | Index dir not persisted | Ensure `FAISS_INDEX_DIR` points to a persistent path |
