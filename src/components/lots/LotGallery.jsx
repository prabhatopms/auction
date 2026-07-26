import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getArtworkUrl, getPrintUrl } from '../../data/lotsData';
import { createFrontCanvasForCard } from './LotsGrid';
import ZoomableImage from './ZoomableImage';

const API = import.meta.env.VITE_API_URL ?? '';

/* Back-of-shirt card drawn client-side — fallback for lots without a
   server-generated back print file. */
export function createBackCanvasForCard(lot, callback) {
  let signalsSummarized = [];
  if (lot?.artworkHeadline && lot.artworkHeadline.startsWith('{')) {
    try {
      const parsed = JSON.parse(lot.artworkHeadline);
      signalsSummarized = parsed.data_signals_used_summarized || [];
    } catch { /* not JSON */ }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';

  // Summarized signals
  if (signalsSummarized.length > 0) {
    ctx.font = '36px Georgia, serif';
    const signalsText = signalsSummarized.join('   •   ');

    const words = signalsText.split(' ');
    let line = '';
    const lines = [];
    const maxWidth = 960;
    const lineHeight = 55;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        lines.push(line.trim());
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line.trim());

    // Center the block vertically, but shifted upwards to sit on the upper back
    const totalHeight = lines.length * lineHeight;
    let currentY = Math.max(250, 800 - (totalHeight / 2) - 400);

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 600, currentY);
      currentY += lineHeight;
    }
  }

  setTimeout(() => callback(canvas), 0);
}

/* Front / back / artwork gallery with zoom and a fullscreen immersive view.
   Used on the lot detail page; shares its shot classes with the peek modal. */
export default function LotGallery({ lot, title }) {
  const [shot, setShot] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const [frontSrc, setFrontSrc] = useState(null);
  const [backSrc, setBackSrc] = useState(null);

  useEffect(() => {
    setShot(0);
    setImmersive(false);
  }, [lot.id]);

  useEffect(() => {
    let mounted = true;

    // Server print files are the source of truth; canvas drawing is the
    // fallback for lots without them.
    const frontPrint = getPrintUrl(lot, 'front', API);
    if (frontPrint) {
      setFrontSrc(frontPrint);
    } else {
      const artworkUrl = getArtworkUrl(lot, API);
      if (artworkUrl) {
        createFrontCanvasForCard(artworkUrl, lot, (canvas) => {
          if (mounted && canvas) setFrontSrc(canvas.toDataURL());
        });
      }
    }

    const backPrint = getPrintUrl(lot, 'back', API);
    if (backPrint) {
      setBackSrc(backPrint);
    } else {
      createBackCanvasForCard(lot, (canvas) => {
        if (mounted && canvas) setBackSrc(canvas.toDataURL());
      });
    }

    return () => { mounted = false; };
  }, [lot]);

  useEffect(() => {
    if (!immersive) return;
    const onKey = (e) => { if (e.key === 'Escape') setImmersive(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [immersive]);

  const shotView = (isImmersive) => {
    const cls = isImmersive ? ' immersive' : '';
    if (shot === 0) {
      return (
        <div className="m-tshirt-wrap">
          <img src="/tshirt_front_black_transparent10small.png" alt="" className={'m-tshirt-base' + cls} />
          {frontSrc && <img src={frontSrc} alt={title} className={'m-chest-art' + cls} />}
        </div>
      );
    }
    if (shot === 1) {
      return (
        <div className="m-tshirt-wrap">
          <img src="/tshirt_back_black_transparent10small.png" alt="" className={'m-tshirt-base' + cls} />
          {backSrc && <img src={backSrc} alt={`${title} — back`} className={'m-chest-art m-back-art' + cls} />}
        </div>
      );
    }
    return frontSrc && (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', padding: isImmersive ? 20 : 12,
      }}>
        <img
          src={frontSrc}
          alt={title}
          style={{
            maxWidth: isImmersive ? '90vw' : 'min(80%, 380px)',
            maxHeight: isImmersive ? '90vh' : '100%',
            objectFit: 'contain',
            borderRadius: 8,
          }}
        />
      </div>
    );
  };

  return (
    <div className="lot-detail-gallery">
      <div className="g-main">
        <ZoomableImage resetKey={shot} onTap={() => setImmersive(true)}>
          {shotView(false)}
        </ZoomableImage>
        <div className="g-hint">Click or scroll to zoom · tap to expand</div>
      </div>

      <div className="m-thumbs">
        <button
          className={'m-thumb' + (shot === 0 ? ' on' : '')}
          onClick={() => setShot(0)}
          title="Front view"
        >
          <div className="m-thumb-tshirt">
            <img src="/tshirt_front_black_transparent10small.png" alt="Front" className="m-thumb-img" />
            {frontSrc && <img src={frontSrc} alt="" className="m-thumb-art" />}
          </div>
        </button>
        <button
          className={'m-thumb' + (shot === 1 ? ' on' : '')}
          onClick={() => setShot(1)}
          title="Back view"
        >
          <div className="m-thumb-tshirt">
            <img src="/tshirt_back_black_transparent10small.png" alt="Back" className="m-thumb-img" />
            {backSrc && <img src={backSrc} alt="" className="m-thumb-art m-back-art" />}
          </div>
        </button>
        {frontSrc && (
          <button
            className={'m-thumb' + (shot === 2 ? ' on' : '')}
            onClick={() => setShot(2)}
            title="Artwork image"
          >
            <div className="m-thumb-tshirt" style={{ padding: 4 }}>
              <img
                src={frontSrc}
                alt="Artwork"
                style={{ width: '90%', height: '90%', objectFit: 'contain', borderRadius: 4 }}
              />
            </div>
          </button>
        )}
      </div>

      {immersive && createPortal(
        <div
          className="immersive-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setImmersive(false); }}
        >
          <ZoomableImage resetKey={`immersive-${shot}`}>
            {shotView(true)}
          </ZoomableImage>
          <button
            className="immersive-close"
            onClick={() => setImmersive(false)}
            aria-label="Back to details"
          >
            ←
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
