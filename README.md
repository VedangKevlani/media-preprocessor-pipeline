# NotebookLM Video Processor

Automates post-processing of videos exported from NotebookLM. Takes raw exports, enhances visual quality, removes the NotebookLM watermark, adds an Intellibus logo, and AI-upscales the result.

## Features

- **Visual Enhancement** — Adjustable saturation and contrast via FFmpeg
- **Logo Swap** — Removes NotebookLM watermark, overlays Intellibus branding
- **AI Upscaling** — Keyframe-based upscaling via Replicate's Real-ESRGAN model
- **CLI & API** — Run as a one-off script or start the NestJS server for endpoint access

---

## Prerequisites

- **Node.js** v18+ (LTS recommended)
- **FFmpeg** installed and available in PATH
  - Windows: `winget install ffmpeg` or download from https://ffmpeg.org/download.html
  - Mac: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
- **Python 3.10+** available as `python` or `py` (used for PPTX/PNG logo replacement)
  - Install required Python packages:
    - `python -m pip install python-pptx pillow numpy`
    - or on Windows: `py -m pip install python-pptx pillow numpy`
- **Replicate Account** (for AI upscaling) — see [Replicate Setup](#replicate-setup)

---

## Project Structure

```
notebooklm-intellibus/
├── notebooklm-intellibus.api/    # NestJS backend (video processing)
├── notebooklm-intellibus.client/ # React frontend (status dashboard)
├── assets/                       # Logo files (intellibus_logo.png)
└── AGENTS.md                     # Agent guidance for AI assistants
```

---

## Quick Start

### 1. Clone & Install Dependencies

```bash
# Clone the repo
git clone <repo-url>
cd notebooklm-intellibus

# Install API dependencies
cd notebooklm-intellibus.api
npm install

# Install client dependencies (React dashboard)
cd ../notebooklm-intellibus.client
npm install
```

### 2. Configure Environment

```bash
cd notebooklm-intellibus.api

# Copy example config
cp .env.example .env

# Edit .env with your settings (see Environment Variables below)
```

### 3. Add Logo File

Place your `intellibus_logo.png` file in the `assets/` folder at the project root. The logo should be a transparent PNG.

### 4. Run the Processor

**Option A: CLI (Single Video)**

```bash
cd notebooklm-intellibus.api
npm run process -- "C:\path\to\your\video.mp4"
```

Output: `video_processed.mp4` saved in the same folder as the input.

**Option B: API Server (Video-only pipeline)**

```bash
cd notebooklm-intellibus.api
npm run start:dev
```

The server starts at `http://localhost:3000`. Use the pipeline endpoint:

```bash
curl -X POST "http://localhost:3000/pipeline/process?inputPath=C:/path/to/video.mp4"
```

**Option C: Full Media Dashboard (Slides / Video / Infographics)**

1. **Start the API with Python configured** (from `notebooklm-intellibus.api`):

   ```bash
   # Windows PowerShell, if Python runs as "py"
   $env:PYTHON_CMD="py"; npm run start:dev

   # or if Python runs as "python"
   $env:PYTHON_CMD="python"; npm run start:dev
   ```

   On Unix shells:

   ```bash
   export PYTHON_CMD=python   # or py
   npm run start:dev
   ```

   The API will listen on `http://localhost:3000` and expose:

   - `POST /pipeline/process-media` — main media pipeline endpoint used by the UI
   - `GET /pipeline/download?file=...` — download processed output

2. **Start the React client** (from `notebooklm-intellibus.client`):

   ```bash
   npm run dev
   ```

   Vite will print a URL like `http://localhost:5173` or `http://localhost:5174`. Open it in your browser.

3. **Use the dashboard**:

   - Pick **Media Type**:
     - Slide Deck (PPTX or PNG slides)
     - Video (MP4)
     - Infographics (PNG)
   - Upload your **media files**
   - Upload your **company logo** (PNG with transparency recommended)
   - Click **Process Media**
   - When complete, click **Download processed output** to save the processed PPTX/MP4/PNG/AVIF.

---

## Environment Variables

Create a `.env` file in `notebooklm-intellibus.api/` with these settings:

```env
# Video Enhancement
SATURATION=1.5              # Color saturation multiplier (1.0 = no change)
CONTRAST=1.2                # Contrast multiplier (1.0 = no change)

# NotebookLM Logo Coordinates (for removal)
# Measure these from your actual NotebookLM export frames
NOTEBOOKLM_LOGO_X=1096
NOTEBOOKLM_LOGO_Y=662
NOTEBOOKLM_LOGO_W=143
NOTEBOOKLM_LOGO_H=18

# Intellibus Logo Position
INTELLIBUS_LOGO_X=1096
INTELLIBUS_LOGO_Y=662
INTELLIBUS_LOGO_SCALE=0.5

# Replicate API (Required for upscaling)
REPLICATE_API_TOKEN=r8_xxxxxxxxxxxxxxxxxxxx

# Keyframe Upscaling Settings
UPSCALE_SCALE=2             # 2x or 4x upscale factor
FRAME_PARALLEL_LIMIT=5      # Concurrent API calls (reduce if rate-limited)
MAX_FRAME_WIDTH=1920        # Auto-downscale frames wider than this
SECONDS_PER_KEYFRAME=3      # Extract 1 keyframe every N seconds

# Cleanup
CLEANUP_INTERMEDIATE_FILES=true
```

### Tuning `SECONDS_PER_KEYFRAME`

This controls how many keyframes are extracted for upscaling:

| Value   | Behavior                                                     |
| ------- | ------------------------------------------------------------ |
| **2**   | More keyframes, smoother result, slower, more API calls      |
| **3**   | Balanced (recommended for most NotebookLM videos)            |
| **4-5** | Fewer keyframes, faster, cheaper, may miss quick transitions |

**Don't set too low** (< 2) — processing becomes very slow and expensive.
**Don't set too high** (> 5) — may skip slide transitions, losing detail.

---

## Replicate Setup

AI upscaling uses [Replicate](https://replicate.com/)'s hosted Real-ESRGAN model. This is a **paid service** (pay-per-prediction).

### Creating an Account

1. Go to https://replicate.com/ and sign up
2. Navigate to **Account Settings** → **API Tokens**
3. Create a new token and copy it
4. Add to your `.env` file as `REPLICATE_API_TOKEN`

### Pricing

- Model: `nightmareai/real-esrgan`
- Cost: ~$0.0023 per image (as of 2024)
- A 90-second video with `SECONDS_PER_KEYFRAME=3` = ~30 keyframes = ~$0.07

### Shared Token Usage

If multiple people share one Replicate token:

1. **Reduce `FRAME_PARALLEL_LIMIT`** to 2-3 (instead of 5) to avoid rate limits
2. Coordinate processing times to avoid simultaneous heavy usage
3. Monitor your Replicate dashboard for usage spikes

For teams, consider having each person create their own Replicate account (free tier includes some credits).

---

## API Endpoints

When running the server (`npm run start:dev`):

| Endpoint                          | Method | Description                               |
| --------------------------------- | ------ | ----------------------------------------- |
| `/pipeline/process?inputPath=...` | POST   | Run full pipeline on a video              |
| `/pipeline/status`                | GET    | Check if pipeline is currently processing |
| `/enhance?inputPath=...`          | POST   | Run enhancement only                      |
| `/logo?inputPath=...`             | POST   | Run logo swap only                        |
| `/upscale?inputPath=...`          | POST   | Run upscaling only                        |

---

## Troubleshooting

### "FFmpeg not found"

Ensure FFmpeg is installed and in your system PATH:

```bash
ffmpeg -version
```

### Rate Limiting (429 errors)

Reduce `FRAME_PARALLEL_LIMIT` in your `.env` to 2 or 3.

### CUDA Out of Memory

The `MAX_FRAME_WIDTH=1920` setting auto-downscales large frames. If you still see OOM errors, try lowering this to 1280.

### Logo in wrong position

NotebookLM export dimensions may vary. Extract a frame and re-measure coordinates:

```bash
ffmpeg -ss 5 -i input.mp4 -frames:v 1 frame.png
```

Open `frame.png` in an image editor and find the exact watermark position.

---

## Contributing

This is a private repository. If you'd like to make changes:

1. Discuss the change with the team first
2. Create a feature branch
3. Submit a Pull Request for review
4. **Do not force push to main**

---

## License

Private — All rights reserved.
