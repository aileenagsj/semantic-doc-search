# Cloud Computer Deployment Guide

This guide walks you through deploying the Python/Ollama/FAISS embedding sidecar to your Manus Cloud Computer.

---

## Prerequisites

- **Cloud Computer** with public IP `34.138.97.42`
- **SSH access** to the Cloud Computer
- **Basic Linux knowledge** (running commands, editing files)

---

## Step 1: SSH into Your Cloud Computer

```bash
ssh ubuntu@34.138.97.42
```

If prompted for a password, check your Manus account settings for the Cloud Computer credentials.

---

## Step 2: Install System Dependencies

Update the package manager and install required tools:

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv curl wget git
```

---

## Step 3: Install Ollama

Download and install Ollama:

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

Verify the installation:

```bash
ollama --version
```

---

## Step 4: Pull the Embedding Model

Pull the `mxbai-embed-large` model (this is a one-time download, ~670 MB):

```bash
ollama pull mxbai-embed-large
```

This may take a few minutes depending on your internet speed.

---

## Step 5: Start Ollama as a Background Service

Start Ollama in the background (it will listen on `http://localhost:11434` by default):

```bash
nohup ollama serve > /tmp/ollama.log 2>&1 &
```

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

You should see a JSON response listing the `mxbai-embed-large` model.

---

## Step 6: Clone or Download the Sidecar Code

Clone the semantic-doc-search repository (or copy the `embed_service/` directory):

```bash
cd /opt
sudo git clone https://github.com/YOUR_USERNAME/semantic-doc-search.git
cd semantic-doc-search/embed_service
```

Alternatively, if you prefer to copy files manually:

```bash
scp -r /home/ubuntu/semantic-doc-search/embed_service ubuntu@34.138.97.42:/opt/embed_service
```

---

## Step 7: Set Up the Python Virtual Environment

```bash
cd /opt/semantic-doc-search/embed_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Step 8: Create a Systemd Service File

Create a systemd service so the sidecar starts automatically on boot:

```bash
sudo nano /etc/systemd/system/embed-sidecar.service
```

Paste the following content:

```ini
[Unit]
Description=Semantic Search Embedding Sidecar
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/semantic-doc-search/embed_service
Environment="PATH=/opt/semantic-doc-search/embed_service/.venv/bin"
Environment="OLLAMA_BASE_URL=http://localhost:11434"
ExecStart=/opt/semantic-doc-search/embed_service/.venv/bin/python main.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Save the file (Ctrl+X, then Y, then Enter).

---

## Step 9: Enable and Start the Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable embed-sidecar.service
sudo systemctl start embed-sidecar.service
```

Verify the service is running:

```bash
sudo systemctl status embed-sidecar.service
```

You should see `active (running)`.

---

## Step 10: Test the Sidecar

From your local machine, test that the sidecar is accessible:

```bash
curl http://34.138.97.42:8765/health
```

You should see a JSON response like:

```json
{
  "status": "healthy",
  "model": "mxbai-embed-large",
  "total_indexed": 0,
  "total_vectors": 0
}
```

---

## Step 11: Configure the Node.js Backend

The `EMBED_SERVICE_URL` environment variable has already been set to `http://34.138.97.42:8765` in your Manus WebDev project. The Node.js backend will automatically connect to the sidecar when it starts.

To verify the connection, check the sidecar status badge in the top nav bar of your website — it should show green (connected) within 30 seconds of the page loading.

---

## Monitoring and Maintenance

### View Sidecar Logs

```bash
sudo journalctl -u embed-sidecar.service -f
```

### Restart the Sidecar

```bash
sudo systemctl restart embed-sidecar.service
```

### Check Sidecar Stats

```bash
curl http://34.138.97.42:8765/health
```

### Check Ollama Logs

```bash
tail -f /tmp/ollama.log
```

---

## Troubleshooting

**Sidecar won't start:**
- Check that Ollama is running: `curl http://localhost:11434/api/tags`
- Check the systemd logs: `sudo journalctl -u embed-sidecar.service -n 50`

**Connection timeout from Node.js backend:**
- Verify the Cloud Computer firewall allows port 8765 inbound
- Test from your local machine: `curl http://34.138.97.42:8765/health`

**Ollama model not found:**
- Re-pull the model: `ollama pull mxbai-embed-large`
- Check available models: `ollama list`

**High memory usage:**
- The `mxbai-embed-large` model uses ~1.5 GB RAM when active
- Ensure your Cloud Computer has at least 2 GB RAM (Basic tier is sufficient)

---

## Next Steps

1. **Re-index existing documents** — after the sidecar is running, use the Re-index button on the Documents page to regenerate embeddings for any documents that were indexed with the n-gram fallback.
2. **Monitor the sidecar status** — the green/amber badge in the nav bar shows the connection status in real time.
3. **Backup the FAISS index** — periodically copy `/opt/semantic-doc-search/embed_service/faiss_index/` to a safe location.

---

## Support

For issues with Ollama, see [ollama.ai](https://ollama.ai).
For issues with the sidecar code, check the `embed_service/README.md` in the project root.
