
import React from 'react';

interface LiveWallpaperProps {
  type: string;
  audioLevel?: number;
}

export const LiveWallpaper: React.FC<LiveWallpaperProps> = React.memo(({ type }) => {
  if (!type) return null;

  // --- NEBULA (CSS-only, no JS animations) ---
  if (type === 'nebula') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black pointer-events-none z-0">
        <div 
          className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] blur-[100px]"
          style={{
            background: 'radial-gradient(ellipse at 30% 40%, rgba(88,28,135,0.4), transparent 70%)',
            animation: 'nebula-pulse 20s ease-in-out infinite',
          }}
        />
        <div 
          className="absolute bottom-[-20%] right-[-20%] w-[140%] h-[140%] blur-[100px]"
          style={{
            background: 'radial-gradient(ellipse at 70% 60%, rgba(30,27,75,0.4), transparent 70%)',
            animation: 'nebula-pulse 25s ease-in-out infinite reverse',
          }}
        />
        <style>{`
          @keyframes nebula-pulse {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
          }
        `}</style>
      </div>
    );
  }

  // --- OCEAN (CSS-only) ---
  if (type === 'ocean') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[#000814] pointer-events-none z-0">
        <div 
          className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-cyan-900/20 to-transparent blur-3xl"
          style={{ animation: 'ocean-wave 10s ease-in-out infinite' }}
        />
        <style>{`
          @keyframes ocean-wave {
            0%, 100% { transform: translateY(0) skewY(6deg) scale(1.5); }
            50% { transform: translateY(-20px) skewY(6deg) scale(1.5); }
          }
        `}</style>
      </div>
    );
  }

  // --- ROSE (CSS-only, reduced from 12 to 6 petals) ---
  if (type === 'rose') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-zinc-950 pointer-events-none z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-rose-950/20 to-black" />
        {[0,1,2,3,4,5].map(i => (
          <div
            key={i}
            className="absolute w-3 h-3 rounded-full bg-rose-500/20 blur-[2px]"
            style={{
              left: `${15 + i * 15}%`,
              animation: `petal-fall ${12 + i * 2}s linear infinite`,
              animationDelay: `${i * 3}s`,
            }}
          />
        ))}
        <style>{`
          @keyframes petal-fall {
            0% { top: -5%; opacity: 0; transform: rotate(0deg); }
            10% { opacity: 0.5; }
            90% { opacity: 0.5; }
            100% { top: 105%; opacity: 0; transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // --- LIVE VIDEO WALLPAPERS ---
  if (typeof type === 'string' && type.startsWith('video:')) {
    const url = type.split('video:')[1];
    return (
      <div className="absolute inset-0 bg-black overflow-hidden pointer-events-none z-0">
        <video 
          key={url}
          autoPlay 
          loop 
          muted 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        >
          <source src={url} type="video/mp4" />
        </video>
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
});
