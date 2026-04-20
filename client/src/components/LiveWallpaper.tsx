
import React, { useEffect, useState } from 'react';

interface LiveWallpaperProps {
  type: string;
  audioLevel?: number;
}

export const LiveWallpaper: React.FC<LiveWallpaperProps> = React.memo(({ type }) => {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (!type) return null;

  // --- NEBULA (Static) ---
  if (type === 'nebula') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black pointer-events-none z-0">
        <div 
          className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] blur-[40px] opacity-30"
          style={{ background: 'radial-gradient(ellipse at 30% 40%, rgba(88,28,135,0.4), transparent 70%)' }}
        />
        <div 
          className="absolute bottom-[-20%] right-[-20%] w-[140%] h-[140%] blur-[40px] opacity-30"
          style={{ background: 'radial-gradient(ellipse at 70% 60%, rgba(30,27,75,0.4), transparent 70%)' }}
        />
      </div>
    );
  }

  // --- OCEAN (Static) ---
  if (type === 'ocean') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[#000814] pointer-events-none z-0">
        <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-cyan-900/10 to-transparent blur-xl" style={{ transform: 'skewY(6deg) scale(1.5)' }} />
      </div>
    );
  }

  // --- ROSE (Static) ---
  if (type === 'rose') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-zinc-950 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-rose-950/10 to-black" />
        {[1,2,3].map(i => (
          <div key={i} className="absolute w-2 h-2 rounded-full bg-rose-500/10 blur-[1px]" style={{ left: `${20 * i}%`, top: `${30 * i}%` }} />
        ))}
      </div>
    );
  }

  // --- VIDEO WALLPAPERS (Disabled live playback) ---
  if (typeof type === 'string' && type.startsWith('video:')) {
    const url = type.split('video:')[1];
    return (
      <div className="absolute inset-0 bg-black overflow-hidden pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
      </div>
    );
  }

  // DEFAULT STATIC IMAGE
  return (
    <div 
      className="absolute inset-0 z-0 opacity-40 pointer-events-none"
      style={{ backgroundImage: `url(${type})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    />
  );
}, (prev, next) => prev.type === next.type);
