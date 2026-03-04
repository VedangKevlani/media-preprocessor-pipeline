import { useState } from 'react';
import './App.css';

const MEDIA_TYPES = {
  SLIDE_DECK: 'slide_deck',
  VIDEO: 'video',
  INFOGRAPHICS: 'infographics',
} as const;

const PIPELINE_STAGES = [
  'Upload validation',
  'Watermark detection',
  'Logo replacement',
  'Reconstruction',
] as const;

type MediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];

function App() {
  const [mediaType, setMediaType] = useState<MediaType>(MEDIA_TYPES.SLIDE_DECK);

  const [slidePngFiles, setSlidePngFiles] = useState<File[]>([]);
  const [slidePptxFile, setSlidePptxFile] = useState<File | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoLogoPosition, setVideoLogoPosition] = useState('top-right');

  const [infographicFiles, setInfographicFiles] = useState<File[]>([]);

  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  function handleMediaTypeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value as MediaType;
    setMediaType(value);
    setSlidePngFiles([]);
    setSlidePptxFile(null);
    setVideoFile(null);
    setInfographicFiles([]);
    setResultUrl(null);
    resetProgress();
  }

  function resetProgress() {
    setIsProcessing(false);
    setProgressPercent(0);
    setCurrentStageIndex(0);
    setCurrentFileName('');
    setErrorMessage('');
  }

  function onSlidePngChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setSlidePngFiles(files);
    setSlidePptxFile(null);
  }

  function onSlidePptxChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSlidePptxFile(file);
    setSlidePngFiles([]);
  }

  function onVideoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setVideoFile(file);
  }

  function onInfographicFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setInfographicFiles(files);
  }

  function onLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
  }

  function getCurrentFiles(): File[] {
    if (mediaType === MEDIA_TYPES.SLIDE_DECK) {
      if (slidePptxFile) return [slidePptxFile];
      return slidePngFiles ?? [];
    }
    if (mediaType === MEDIA_TYPES.VIDEO) {
      return videoFile ? [videoFile] : [];
    }
    if (mediaType === MEDIA_TYPES.INFOGRAPHICS) {
      return infographicFiles ?? [];
    }
    return [];
  }

  function validateInputs() {
    const files = getCurrentFiles();
    if (files.length === 0) return false;
    if (!logoFile) return false;
    return true;
  }

  async function handleRunPipeline() {
    if (!validateInputs() || isProcessing) return;

    resetProgress();
    setIsProcessing(true);
    setResultUrl(null);
    setCurrentStageIndex(0);
    setProgressPercent(0);

    try {
      const files = getCurrentFiles();
      if (files[0]) {
        setCurrentFileName(files[0].name);
      }

      const formData = new FormData();
      formData.append('mediaType', mediaType);
      formData.append('videoLogoPosition', videoLogoPosition);
      if (logoFile) {
        formData.append('logo', logoFile);
      }

      files.forEach((file) => {
        formData.append('mediaFiles', file);
      });

      const progressInterval = window.setInterval(() => {
        setProgressPercent((prev) => {
          if (prev >= 90) return prev;
          return prev + 5;
        });
      }, 400);

      const res = await fetch(
        'http://localhost:3000/pipeline/process-media',
        {
          method: 'POST',
          body: formData,
        },
      );

      window.clearInterval(progressInterval);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Processing failed');
      }

      const data: { downloadUrl?: string } = await res.json();

      const apiBase = 'http://localhost:3000';
      const absoluteUrl =
      data.downloadUrl && !data.downloadUrl.startsWith('http')
          ? `${apiBase}${data.downloadUrl}`
          : data.downloadUrl ?? null;

      setResultUrl(absoluteUrl);
      setProgressPercent(100);
      setCurrentStageIndex(PIPELINE_STAGES.length - 1);
      setCurrentFileName('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Pipeline failed',
      );
      setIsProcessing(false);
      return;
    }

    setIsProcessing(false);
  }

  function renderMediaSpecificUpload() {
    if (mediaType === MEDIA_TYPES.SLIDE_DECK) {
      return (
        <div className="panel">
          <h3>Slide Deck Upload</h3>
          <p className="hint">
            Upload a single PPTX. <strong></strong> 
          </p>

          <div className="field-group">
            <label className="field-label">PPTX (single)</label>
            <input
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={onSlidePptxChange}
            />
          </div>

          <p className="hint">
            Output will be a PPTX file or ZIP archive of processed PNG slides.
          </p>
        </div>
      );
    }

    if (mediaType === MEDIA_TYPES.VIDEO) {
      return (
        <div className="panel">
          <h3>Video Upload</h3>
          <div className="field-group">
            <label className="field-label">MP4 video</label>
            <input type="file" accept="video/mp4" onChange={onVideoFileChange} />
            <p className="hint">Only MP4 is supported.</p>
          </div>

          <div className="field-group">
            <label className="field-label">Logo position</label>
            <div className="inline-options">
              {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(
                (pos) => (
                  <label key={pos} className="inline-option">
                    <input
                      type="radio"
                      name="logoPosition"
                      value={pos}
                      checked={videoLogoPosition === pos}
                      onChange={(e) => setVideoLogoPosition(e.target.value)}
                    />
                    <span>{formatPositionLabel(pos)}</span>
                  </label>
                ),
              )}
            </div>
            <p className="hint">
              The logo will be placed at the selected corner on each frame.
            </p>
          </div>

          <p className="hint">Output will be a processed MP4 video.</p>
        </div>
      );
    }

    if (mediaType === MEDIA_TYPES.INFOGRAPHICS) {
      return (
        <div className="panel">
          <h3>Infographics Upload</h3>
          <div className="field-group">
            <label className="field-label">PNG files (batch)</label>
            <input
              type="file"
              accept="image/png"
              multiple
              onChange={onInfographicFilesChange}
            />
            <p className="hint">
              Uses the same logo replacement pipeline as slide decks.
            </p>
          </div>
          <p className="hint">
            Output: processed PNGs or compressed archive (ZIP), depending on
            backend configuration.
          </p>
        </div>
      );
    }

    return null;
  }

  function renderProgress() {
    if (!isProcessing && progressPercent === 0 && !resultUrl && !errorMessage) {
      return null;
    }

    const stageLabel =
      PIPELINE_STAGES[currentStageIndex] ?? PIPELINE_STAGES[0];

    return (
      <div className="panel">
        <h3>Processing Status</h3>

        <div className="field-group">
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="progress-meta">
            <span>{progressPercent}%</span>
            <span>{stageLabel}</span>
          </div>
        </div>

        {currentFileName && (
          <p className="hint">
            Currently processing: <strong>{currentFileName}</strong>
          </p>
        )}

        <ul className="stage-list">
          {PIPELINE_STAGES.map((stage, idx) => (
            <li
              key={stage}
              className={
                idx < currentStageIndex
                  ? 'stage-complete'
                  : idx === currentStageIndex
                  ? 'stage-active'
                  : 'stage-pending'
              }
            >
              {stage}
            </li>
          ))}
        </ul>

        {errorMessage && <p className="hint error">Error: {errorMessage}</p>}

        {resultUrl && !isProcessing && (
          <div className="field-group">
            <a href={resultUrl} className="primary-link">
              Download processed output
            </a>
          </div>
        )}
      </div>
    );
  }

  const canRun = validateInputs() && !isProcessing;
  const runLabel = isProcessing
    ? 'Processing...'
    : resultUrl
    ? 'Re-run Pipeline'
    : 'Process Media';

  return (
    <div className="dashboard-root">
      <div className="dashboard-card">
        <header className="dashboard-header">
          <h2>Media Watermark &amp; Logo Pipeline</h2>
          <p className="subtitle">
            Upload your media, choose a mode, and run the watermark removal +
            logo replacement pipeline.
          </p>
        </header>

        <section className="panel">
          <h3>Media Type</h3>
          <div className="inline-options">
            <label className="inline-option">
              <input
                type="radio"
                name="mediaType"
                value={MEDIA_TYPES.SLIDE_DECK}
                checked={mediaType === MEDIA_TYPES.SLIDE_DECK}
                onChange={handleMediaTypeChange}
              />
              <span>Slide Deck</span>
            </label>
            <label className="inline-option">
              <input
                type="radio"
                name="mediaType"
                value={MEDIA_TYPES.VIDEO}
                checked={mediaType === MEDIA_TYPES.VIDEO}
                onChange={handleMediaTypeChange}
              />
              <span>Video</span>
            </label>
            <label className="inline-option">
              <input
                type="radio"
                name="mediaType"
                value={MEDIA_TYPES.INFOGRAPHICS}
                checked={mediaType === MEDIA_TYPES.INFOGRAPHICS}
                onChange={handleMediaTypeChange}
              />
              <span>Infographics</span>
            </label>
          </div>
        </section>

        {renderMediaSpecificUpload()}

        <section className="panel">
          <h3>Logo Replacement</h3>
          <div className="field-group">
            <label className="field-label">Company logo</label>
            <input
              type="file"
              accept="image/png,image/*"
              onChange={onLogoFileChange}
            />
            <p className="hint">
              PNG with transparency recommended. Suggested size: 256×256 or
              higher.
            </p>
          </div>
        </section>

        <section className="panel">
          <h3>Run Pipeline</h3>
          <button
            type="button"
            className={`primary-button ${
              !canRun ? 'primary-button-disabled' : ''
            }`}
            disabled={!canRun}
            onClick={handleRunPipeline}
          >
            {isProcessing && <span className="spinner" />}
            <span>{runLabel}</span>
          </button>
          {!validateInputs() && (
            <p className="hint error">
              Please upload media files and a logo before running the pipeline.
            </p>
          )}
        </section>

        {renderProgress()}
      </div>
    </div>
  );
}

function formatPositionLabel(pos: string) {
  return pos
    .split('-')
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ');
}

export default App;
