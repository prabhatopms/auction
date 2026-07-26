import { useState, useEffect, useRef, useCallback } from 'react';

/* ---------- Pinch/scroll zoom wrapper ---------- */
export default function ZoomableImage({ children, resetKey, onTap }) {
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);

  const startDist = useRef(null);
  const startScale = useRef(1);
  const startOffset = useRef({ x: 0, y: 0 });

  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const touchMoved = useRef(false);
  const lastTouchEnd = useRef(0);
  const containerRef = useRef(null);

  useEffect(() => {
    setZoom({ scale: 1, x: 0, y: 0 });
    initialized.current = false;
    startDist.current = null;
  }, [resetKey]);

  const clampOffset = (ox, oy, s) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const maxShiftX = Math.max(0, (s - 1) * (rect.width / 2));
    const maxShiftY = Math.max(0, (s - 1) * (rect.height / 2));
    return {
      x: Math.max(-maxShiftX, Math.min(maxShiftX, ox)),
      y: Math.max(-maxShiftY, Math.min(maxShiftY, oy)),
    };
  };

  const updateOrigin = (clientX, clientY, currentScale, currentX, currentY) => {
    if (!containerRef.current) return { x: currentX, y: currentY };
    const rect = containerRef.current.getBoundingClientRect();
    const newOriginX = clientX - rect.left;
    const newOriginY = clientY - rect.top;

    if (!initialized.current) {
      origin.current = { x: rect.width / 2, y: rect.height / 2 };
      initialized.current = true;
    }

    const dx = (origin.current.x - newOriginX) * (1 - currentScale);
    const dy = (origin.current.y - newOriginY) * (1 - currentScale);

    origin.current = { x: newOriginX, y: newOriginY };
    return { x: currentX + dx, y: currentY + dy };
  };

  const onTouchStart = (e) => {
    touchMoved.current = false;
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      startDist.current = Math.sqrt(dx * dx + dy * dy);
      startScale.current = zoom.scale;
      startOffset.current = { x: zoom.x, y: zoom.y };

      const touchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const touchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const shifted = updateOrigin(touchX, touchY, zoom.scale, zoom.x, zoom.y);

      setZoom((z) => ({ ...z, x: shifted.x, y: shifted.y }));
      startOffset.current = shifted;
    } else if (e.touches.length === 1) {
      dragging.current = true;
      dragStart.current = {
        x: e.touches[0].clientX - zoom.x,
        y: e.touches[0].clientY - zoom.y,
      };
    }
  };

  const onTouchMove = (e) => {
    touchMoved.current = true;
    if (e.touches.length === 2) {
      e.preventDefault();
      if (startDist.current && startDist.current > 0) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist / startDist.current;
        const ns = Math.min(5, Math.max(1, startScale.current * ratio));

        const touchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const touchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const shifted = updateOrigin(touchX, touchY, zoom.scale, zoom.x, zoom.y);

        const clamped = clampOffset(shifted.x, shifted.y, ns);
        setZoom({ scale: ns, x: clamped.x, y: clamped.y });
      }
    } else if (e.touches.length === 1 && dragging.current) {
      e.preventDefault();
      const nx = e.touches[0].clientX - dragStart.current.x;
      const ny = e.touches[0].clientY - dragStart.current.y;
      setZoom((z) => {
        if (z.scale <= 1) return z;
        const clamped = clampOffset(nx, ny, z.scale);
        return { ...z, x: clamped.x, y: clamped.y };
      });
    }
  };

  const onTouchEnd = (e) => {
    if (e.touches.length < 2) {
      startDist.current = null;
    }
    if (e.touches.length === 1 && dragging.current) {
      dragStart.current = {
        x: e.touches[0].clientX - zoom.x,
        y: e.touches[0].clientY - zoom.y,
      };
    }
    if (e.touches.length === 0) {
      const wasTap = !touchMoved.current;
      dragging.current = false;
      touchMoved.current = false;
      lastTouchEnd.current = Date.now();
      setZoom((z) => {
        if (z.scale <= 1.05) {
          if (wasTap && onTap) onTap();
          return { scale: 1, x: 0, y: 0 };
        }
        return z;
      });
    }
  };

  const onMouseDown = (e) => {
    if (zoom.scale > 1) {
      dragging.current = true;
      dragStart.current = {
        x: e.clientX - zoom.x,
        y: e.clientY - zoom.y,
      };
    }
  };

  const onMouseMove = (e) => {
    if (!dragging.current) return;
    e.preventDefault();
    const nx = e.clientX - dragStart.current.x;
    const ny = e.clientY - dragStart.current.y;
    setZoom((z) => {
      if (z.scale <= 1) return z;
      const clamped = clampOffset(nx, ny, z.scale);
      return { ...z, x: clamped.x, y: clamped.y };
    });
  };

  const onMouseUpOrLeave = () => {
    dragging.current = false;
  };

  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => {
      const ns = Math.min(5, Math.max(1, z.scale * factor));
      if (ns <= 1.05) {
        return { scale: 1, x: 0, y: 0 };
      }
      const shifted = updateOrigin(e.clientX, e.clientY, z.scale, z.x, z.y);
      const clamped = clampOffset(shifted.x, shifted.y, ns);
      return { scale: ns, x: clamped.x, y: clamped.y };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const onClick = useCallback(() => {
    if (Date.now() - lastTouchEnd.current < 500) return;
    if (zoom.scale <= 1.05 && onTap) onTap();
  }, [onTap, zoom.scale]);

  const getTransformOriginStr = () => {
    if (!initialized.current) return 'center center';
    return `${origin.current.x}px ${origin.current.y}px`;
  };

  return (
    <div
      ref={containerRef}
      style={{
        overflow: 'hidden',
        cursor: 'zoom-in',
        userSelect: 'none',
        touchAction: 'none',
        width: '100%',
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUpOrLeave}
      onMouseLeave={onMouseUpOrLeave}
    >
      <div
        style={{
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          transformOrigin: getTransformOriginStr(),
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
      {zoom.scale > 1 && (
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          fontSize: '10px', borderRadius: 4, padding: '2px 6px',
          pointerEvents: 'none', letterSpacing: '0.04em',
        }}>
          {Math.round(zoom.scale * 100)}%
        </div>
      )}
    </div>
  );
}
