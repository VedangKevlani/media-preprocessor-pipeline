# AGENTS.md — NotebookLM Video Processor

## Project Intent

This project automates the post-processing of videos exported from NotebookLM. The goal is to take raw NotebookLM video exports, enhance their visual quality, rebrand them by removing the NotebookLM watermark and replacing it with the Intellibus logo, and return the finished video — all triggered automatically via Google Drive.

The system is designed so that a user simply drops a video into a designated Google Drive folder and receives a fully processed, rebranded video back in that same folder — no manual steps required.

---

## Versioning Strategy

This project is built in two versions. **Build and fully verify v1 before touching v2.**

### v1 — Simple, No Queue (Build This First)

- No Bull, no Redis
- NestJS processes videos using a simple `async/await` chain
- An in-memory `isProcessing` flag prevents overlapping runs from the Drive poller
- Sufficient for single-video-at-a-time workflows
- Easier to debug, faster to build, no extra infrastructure

### v2 — Bull Queue + Redis (Add Later If Needed)

- Introduce Bull and Redis only when one of these problems actually occurs:
  - Multiple videos land in Drive simultaneously and need to be queued
  - A crash causes a job to silently disappear and needs retry logic
  - The React dashboard needs real-time job progress (not just polling a status endpoint)
- Redis becomes a required dependency at this point
- Bull replaces the `isProcessing` flag with a proper job queue

---

## Architecture

### v1 Stack

- **Frontend:** React (simple status dashboard — shows current job state and output link)
- **Backend:** NestJS (REST API + async video pipeline)
- **Queue:** None — in-memory `isProcessing` flag only
- **Video Processing:** FFmpeg via `fluent-ffmpeg`
- **AI Upscaling:** Replicate API → Real-ESRGAN model
- **Cloud Storage:** Google Drive API (polling every 60s)

### v2 Stack (Additions Only)

- **Queue:** Bull (Redis-backed job queue)
- **Infrastructure:** Redis (local Docker container or managed Redis)
- **Dashboard:** Enhanced React dashboard with real-time Bull job status

### v1 High-Level Flow

```
Google Drive (input folder)
        ↓  [polling every 60s]
   DriveWatcherService
        ↓  [if not already processing]
   VideoProcessingService
        ├── Step 1: FFmpeg enhance (saturation + contrast)
        ├── Step 2: FFmpeg logo removal + Intellibus overlay
        └── Step 3: Keyframe upscale (extract → upscale → interpolate)
        ↓
   DriveUploadService
        ↓
   Google Drive (output folder)
```

### v2 High-Level Flow (Replaces v1 Flow)

```
Google Drive (input folder)
        ↓  [polling every 60s]
   DriveWatcherService
        ↓
   Bull Job Queue  ←─── replaces isProcessing flag
        ↓
   VideoProcessingService (same pipeline as v1)
        ↓
   DriveUploadService
        ↓
   Google Drive (output folder)
```

### Project Structure

```
/
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── JobStatus.tsx       # Current job state display
│       │   ├── ProgressBar.tsx     # v2: real-time Bull progress
│       │   └── OutputLink.tsx      # Link to processed file in Drive
│       └── App.tsx
│
├── backend/
│   └── src/
│       ├── drive/
│       │   ├── drive-watcher.service.ts    # Polls Drive input folder
│       │   ├── drive-download.service.ts   # Downloads new files
│       │   └── drive-upload.service.ts     # Uploads processed files
│       ├── pipeline/
│       │   ├── video-processing.service.ts   # Orchestrates all steps
│       │   ├── ffmpeg-enhance.service.ts     # Saturation + contrast
│       │   ├── ffmpeg-logo.service.ts        # delogo + overlay
│       │   ├── frame-extraction.service.ts   # FFmpeg frame utils
│       │   └── replicate-upscale.service.ts  # Keyframe upscaling
│       ├── jobs/                             # v2 only — Bull queue
│       │   ├── video.queue.ts
│       │   └── video.processor.ts
│       └── app.module.ts
│
├── assets/
│   └── intellibus_logo.png         # Must be RGBA PNG with transparency
│
└── AGENTS.md
```

---

## The 4 Core Features

### 1. Saturation & Contrast Enhancement

- **Tool:** FFmpeg
- **Method:** Apply `eq` filter chain on the input video in a single encode pass
- **Filter example:** `ffmpeg -vf eq=saturation=1.5:contrast=1.2`
- **Goal:** Improve the flat/washed-out visual quality typical of screen-recorded NotebookLM exports
- **Note:** `SATURATION` and `CONTRAST` values must be configurable via environment variables

### 2. AI Upscaling (Keyframe-Based)

- **Tool:** Replicate API → `nightmareai/real-esrgan` IMAGE model
- **Method:** Keyframe-only upscaling optimized for slideshow-style NotebookLM videos
  1. Extract keyframes at configurable interval (default: 1 frame every 3 seconds)
  2. Auto-downscale frames >1920px wide to prevent CUDA OOM errors
  3. Upscale each keyframe via Replicate (parallel, configurable concurrency)
  4. Use FFmpeg `minterpolate` to generate smooth transitions between keyframes
  5. Mux original audio back into the upscaled video
- **Why keyframes?** NotebookLM videos are slide-based — most frames are duplicates. Upscaling every frame wastes API calls and hits rate limits.
- **Fallback:** If a frame fails, log the error and use the original frame. Pipeline continues with partial upscaling rather than failing entirely.
- **Configuration:**
  - `SECONDS_PER_KEYFRAME=3` — extract 1 keyframe every N seconds
  - `UPSCALE_SCALE=2` — upscale factor (2x or 4x)
  - `MAX_FRAME_WIDTH=1920` — auto-downscale threshold
  - `FRAME_PARALLEL_LIMIT=5` — concurrent Replicate calls

### 3. NotebookLM Logo Removal + Intellibus Logo Overlay

- **Tool:** FFmpeg
- **Logo Removal:** FFmpeg `delogo` filter targeting hardcoded pixel coordinates of the NotebookLM watermark
  - Example: `ffmpeg -vf delogo=x=10:y=10:w=120:h=40`
  - **Before coding:** manually extract a frame with `ffmpeg -ss 5 -i input.mp4 -frames:v 1 frame.png` and measure exact logo coordinates
  - Coordinates stored as environment variables, not hardcoded in logic
- **Logo Addition:** FFmpeg `overlay` filter compositing the Intellibus PNG at a configured position
  - Example: `ffmpeg -i input.mp4 -i intellibus_logo.png -filter_complex "overlay=10:10"`
  - Logo file lives at `/assets/intellibus_logo.png` and must be RGBA PNG
- **Important:** Combine this FFmpeg step with the enhancement step (Feature 1) into a single command to avoid re-encoding

### 4. Google Drive Integration (Trigger & Return)

- **Tool:** Google Drive API via `googleapis` npm package
- **Auth:** OAuth2 service account — credentials in environment variables
- **v1 Method:** Poll the input folder every 60 seconds for new `.mp4` files not yet processed
  - On detection: download → process → upload to output folder → mark original as processed (rename or move to `/processed` subfolder)
- **v2 Enhancement:** Replace polling with Drive push notification webhooks (requires public HTTPS endpoint — use ngrok for local dev)
- **Goal:** Zero-touch workflow — drop a video in Drive, get back a processed video automatically

---

## Build & Test Plan

Work through these phases in order. Do not move to the next phase until the current one is verified.

### Phase 1 — FFmpeg Enhancement (Local Only)

**Goal:** Prove the core video improvement works before touching any external services.

- Build `ffmpeg-enhance.service.ts` — takes a local input path, applies saturation + contrast, writes output file
- Test: run on a real NotebookLM export, open the output, visually confirm it looks bolder and sharper
- Pass/fail is visual and immediate

### Phase 2 — Logo Removal + Overlay (Local Only)

**Goal:** Nail the branding swap while still fully local.

- First, manually extract a frame from a real NotebookLM export to identify exact watermark coordinates
- Build `ffmpeg-logo.service.ts` — applies `delogo` at those coordinates, then overlays `intellibus_logo.png`
- **Combine Phase 1 and Phase 2 into a single FFmpeg command** to avoid double-encoding
- Test: extract a frame from the output with `ffmpeg -ss 5 -i output.mp4 -frames:v 1 check.png`, confirm NotebookLM logo is gone and Intellibus logo is present

### Phase 3 — Replicate Upscaling (Isolated External Call)

**Goal:** Prove the Replicate API works in isolation before wiring it into the pipeline.

- Build `replicate-upscale.service.ts` as a standalone service
- Test with a short 5–10 second clip only — full video upscaling is slow and costly during testing
- Verify output quality improvement and measure turnaround time
- Only after this passes standalone, wire it into `video-processing.service.ts` between the enhance and logo steps

### Phase 4 — Full Pipeline (Wired Together, Local)

**Goal:** One service call processes a local file end-to-end.

- Build `video-processing.service.ts` — calls enhance → upscale → logo in sequence
- Test: pass a local file path, confirm the final output has all three improvements applied
- Add the `isProcessing` flag here to prevent re-entrant calls

### Phase 5 — Google Drive Utilities (Auth + File I/O)

**Goal:** Prove Drive auth and file round-trip work before adding the watcher.

- Build `drive-download.service.ts` and `drive-upload.service.ts`
- Test independently: download a test video from Drive by file ID, re-upload it, confirm it appears in the output folder
- Get OAuth working here — do not leave auth debugging to the final step

### Phase 6 — Drive Watcher + Full End-to-End (v1 Complete)

**Goal:** The zero-touch workflow works.

- Build `drive-watcher.service.ts` — polls input folder every 60s, detects new files, calls the pipeline, uploads result
- Test: drop a video in the Drive input folder, wait up to 60 seconds, confirm the processed video appears in the output folder
- v1 is complete and verified at this point

### Phase 7 — Bull Queue + Redis (v2, Only If Needed)

**Goal:** Handle concurrent videos and add reliability.

- Only start this phase if you hit a real problem: simultaneous videos, job loss on crash, or need for real-time dashboard progress
- Replace `isProcessing` flag with a Bull queue in `jobs/video.queue.ts`
- Add Redis (Docker: `docker run -p 6379:6379 redis`)
- Update the React dashboard to pull real-time job status from Bull
- Test: drop two videos simultaneously into Drive, confirm they queue and process one at a time without errors

---

## Environment Variables

```env
# Google Drive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
DRIVE_INPUT_FOLDER_ID=
DRIVE_OUTPUT_FOLDER_ID=

# Replicate (AI Upscaling)
REPLICATE_API_TOKEN=

# FFmpeg — NotebookLM Logo Coordinates (measured from actual export frame)
NOTEBOOKLM_LOGO_X=1096
NOTEBOOKLM_LOGO_Y=662
NOTEBOOKLM_LOGO_W=143
NOTEBOOKLM_LOGO_H=18

# FFmpeg — Intellibus Logo Position (same position as removed logo)
INTELLIBUS_LOGO_X=1096
INTELLIBUS_LOGO_Y=662

# Video Enhancement
SATURATION=1.5
CONTRAST=1.2

# Keyframe Upscaling
SECONDS_PER_KEYFRAME=3
UPSCALE_SCALE=2
FRAME_PARALLEL_LIMIT=5
MAX_FRAME_WIDTH=1920

# v2 Only — Redis / Bull Queue
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## Agent Guidance

- **Ask clarifying questions when in plan mode.** Before implementing features, confirm ambiguous requirements with the user. Prefer proposing a sensible default so users can confirm quickly.
- **Current target is v1.** Do not scaffold Bull, Redis, or queue-related files unless explicitly instructed to move to v2.
- Always process pipeline steps in order: **enhance → logo → upscale** (logo applied before upscaling to preserve hardcoded pixel coordinates)
- FFmpeg services expose `getFilterConfig()` for composability. Enhancement and logo steps are combined into a single FFmpeg pass.
- Upscaling runs last because it changes the video resolution, which would invalidate logo coordinates
- Processed output files must use a `_processed` suffix (e.g. `original-name_processed.mp4`) to avoid overwriting source files in Drive
- The Intellibus logo PNG lives at `/assets/intellibus_logo.png` and must be RGBA PNG with transparency
- NotebookLM logo coordinates **must be measured from a real export frame** before the `delogo` values are finalised — do not guess or use placeholder values
- The `isProcessing` boolean in `VideoProcessingService` is the v1 concurrency guard — respect it
- When moving to v2, the `isProcessing` flag is removed entirely and replaced by Bull queue concurrency settings
- Keyframe upscaling is preferred for NotebookLM videos — they are slideshow-style with many duplicate frames
