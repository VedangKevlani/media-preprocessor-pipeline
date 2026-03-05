### NotebookLM Preprocessor – Setup & Run Guide
## Overview

This project provides a media processing dashboard and backend pipeline that:

- Removes NotebookLM watermarks

- Replaces them with your logo

Supported Media Types

Slide decks

.pptx

.png slides

Videos

.mp4

Infographics

.png → processed .png / .avif

Tech Stack

- Frontend

- React

- Vite
(notebooklm-intellibus.client)

Backend

- NestJS
(notebooklm-intellibus.api)

Python Utilities

slides.py
```
image_pipeline.py
```
## Media Processing

FFmpeg (video + PNG → AVIF)

## 1. Prerequisites

Install the following:

- Node

- Node.js v18+ recommended

- npm v9+ recommended

- Python

- Python 3.10+

Accessible as:
```
python
```
or
```
py
```
## FFmpeg

Must be installed and available in PATH.

Check installation:
```
ffmpeg -version
```
## Git

- Used to clone the repository.

## Required Python Packages

Install into the same Python interpreter used by the backend.
```
pip install python-pptx pillow numpy
```
Windows users commonly run:
```
py -m pip install python-pptx pillow numpy
```
## 2. Clone the Repository
```
git clone <your-github-url>.git
cd NotebookLM\ Preprocessor/notebooklm-intellibus
```
Adjust the path depending on where the repo was cloned.

## 3. Backend Setup (notebooklm-intellibus.api)
## 3.1 Install Dependencies
```
cd notebooklm-intellibus.api
npm install
```
## 3.2 Environment Variables

An .env.example file is included.

Create your environment file:
```
cp .env.example .env
```
Then open .env and configure:

API keys (if required)

Logo replacement settings

Other pipeline configuration

Defaults typically work for local development.

## 3.3 Ensure Python & FFmpeg Are Available

## Python

Check:
```
py --version
```
or
```
python --version
```
## FFmpeg
ffmpeg -version

If either command fails, install them and ensure they are in PATH.

## 3.4 Start the Backend (NestJS)

Inside:

notebooklm-intellibus.api
Windows PowerShell (Python = py)
```
$env:PYTHON_CMD="py";
npm run start:dev
```
Windows (Python = python)
```
$env:PYTHON_CMD="python"; npm run start:dev
```
macOS / Linux
```
export PYTHON_CMD=python
npm run start:dev
```
## Backend Endpoints

Server runs on:
```
http://localhost:3000
```
Available routes:
```
POST /pipeline/process-media
GET  /pipeline/download?file=...
GET  /pipeline/status
```
Successful startup message:
```
Nest application successfully started
```
## 4. Frontend Setup (notebooklm-intellibus.client)

Open a new terminal.

## 4.1 Install Dependencies
```
cd notebooklm-intellibus.client
npm install
```
## 4.2 Start the Frontend
```
npm run dev
```
Vite will print a local URL such as:
```
http://localhost:5173
```
or
```
http://localhost:5174
```
Open the URL in your browser.

## 5. Using the Media Dashboard

With both frontend and backend running:

Open:
```
http://localhost:5173
```
You will see the Media Watermark & Logo Pipeline dashboard.

## 5.1 Choose Media Type
Slide Deck

Upload:

- One .pptx file

OR multiple .png slides

Output:

- Processed .pptx

- Processed .png

- Video

Upload:

- Single .mp4

Select logo position:

- Top-left

- Top-right

- Bottom-left

- Bottom-right

Output:

- Processed .mp4 with:

- watermark removed

- replacement logo added

Infographics

Upload:

- One or more .png files
(Current backend processes one at a time)

Output:

- Processed .png

- Optional .avif (lossless PNG → AVIF via FFmpeg)

5.2 Upload Logo

In the Logo Replacement panel:

Upload a logo file.

Recommended:

.png

- Transparent background

- 256×256 or larger

5.3 Run the Pipeline

Click:

- Process Media

The dashboard will display:

- Progress percentage

- Current pipeline stage

- Name of file currently processing

Pipeline stages include:

- Upload validation

- Watermark detection

- Logo replacement

- Reconstruction

## 5.4 Download the Result

After processing finishes:

A link appears:

Download processed output

The link points to:
```
http://localhost:3000/pipeline/download
```
Click to save the processed file.

## 6. Troubleshooting
## 6.1 "Failed to fetch" in the Frontend

Verify the backend is running.

Visit:
```
http://localhost:3000/pipeline/status
```
Expected response:
```
{"isProcessing": false}
```
If not:

- Ensure npm run start:dev is running

Check the backend terminal for errors

## 6.2 CORS Errors

Backend enables CORS with:
```
app.enableCors({ origin: true });
```
Verify:

API runs on
```
http://localhost:3000
```
Frontend runs on
```
http://localhost:5173
```
or
```
http://localhost:5174
```
## 6.3 Python Not Found / Exit Code 9009

Example error:
```
Python was not found; run without arguments to install from the Microsoft Store
```
or
```
Exit code 9009
```
Fix:

Check Python:
```
py --version
```
Then start backend with:
```
$env:PYTHON_CMD="py"; npm run start:dev
```
## 6.4 Python Module Error

Example:
```
ModuleNotFoundError: No module named 'pptx'
```
Install packages:
```
py -m pip install python-pptx pillow numpy
```
or
```
python -m pip install python-pptx pillow numpy
```
Restart backend afterward.

6.5 Unicode Errors in slides.py

If you see:
```
UnicodeEncodeError
```
Ensure print statements contain only ASCII characters.

Example:
```
print(f"Slide {slide_num}")
print(f"Saved -> {output_path}")
```
## 7. Project Structure
notebooklm-intellibus/

├── notebooklm-intellibus.client/

│   React + Vite frontend

│
├── notebooklm-intellibus.api/

│   NestJS backend

│

├── slides.py

│   PPTX watermark removal + logo replacement

│

├── image_pipeline.py

│   PNG processing pipeline

│

└── png-to-avif/

    convert.py
    PNG → AVIF conversion script
