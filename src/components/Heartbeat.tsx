import { useEffect, useRef, useState } from 'react';

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const WIDTH = 12;

/** Live monospace sparkline reading a tick source.
 *  Drives off the browser's animation frame + a running average so it
 *  doesn't stall when nothing's happening — still shows a baseline pulse. */
export default function Heartbeat() {
  const [bars, setBars] = useState<string[]>(() => Array(WIDTH).fill('▁'));
  const lastRef = useRef(performance.now());
  const pulseRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const dt = t - lastRef.current;
      lastRef.current = t;
      // dt around 16-18ms in normal conditions; synthesize a living-EKG
      // curve by combining frame jitter and a slow sine.
      pulseRef.current += dt / 1000;
      const base = 3 + 2 * Math.sin(pulseRef.current * 2.1);
      const jitter = Math.min(4, Math.abs(dt - 16) / 4);
      const idx = Math.min(BARS.length - 1, Math.max(0, Math.floor(base + jitter)));
      setBars((b) => {
        const next = b.slice(1);
        next.push(BARS[idx]);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <span className="heartbeat" aria-hidden>{bars.join('')}</span>;
}
