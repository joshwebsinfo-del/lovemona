
import React from 'react';
import { motion } from 'framer-motion';

interface LiveWallpaperProps {
  type: string;
  audioLevel?: number; // 0 to 1
}

export const LiveWallpaper: React.FC<LiveWallpaperProps> = ({ type, audioLevel = 0 }) => {
  if (!type) return null;

  const reactiveScale = 1 + (audioLevel * 0.15); // Scale up to 15% with audio
  const reactiveOpacity = 0.3 + (audioLevel * 0.4); // Brighten with audio

  // --- NEBULA ANIMATION ---
  if (type === 'nebula') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black pointer-events-none z-0">
        <motion.div 
          animate={{ scale: [1 * reactiveScale, 1.2 * reactiveScale, 1 * reactiveScale], rotate: [0, 5, 0], opacity: [0.3, reactiveOpacity, 0.3] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-gradient-to-br from-purple-900/40 via-fuchsia-900/20 to-transparent blur-[100px]"
        />
        <motion.div 
          animate={{ scale: [1.2 * reactiveScale, 1 * reactiveScale, 1.2 * reactiveScale], rotate: [0, -5, 0], opacity: [0.2, reactiveOpacity - 0.1, 0.2] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-[-20%] right-[-20%] w-[140%] h-[140%] bg-gradient-to-tl from-indigo-900/40 via-blue-900/20 to-transparent blur-[100px]"
        />
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.8, 0], scale: [0, 1, 0] }}
            transition={{ duration: Math.random() * 3 + 2, repeat: Infinity, delay: Math.random() * 5 }}
            className="absolute w-1 h-1 bg-white rounded-full"
            style={{ top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%` }}
          />
        ))}
      </div>
    );
  }

  // --- OCEAN ANIMATION ---
  if (type === 'ocean') {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[#000814] pointer-events-none z-0">
         <motion.div 
           animate={{ y: [0, -20, 0] }}
           transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
           className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-cyan-900/20 to-transparent skew-y-6 scale-150 blur-3xl"
         />
         <motion.div 
           animate={{ y: [0, 20, 0] }}
           transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
           className="absolute inset-x-0 bottom-0 h-full bg-gradient-to-t from-blue-900/20 to-transparent -skew-y-6 scale-150 blur-3xl opacity-50"
         />
      </div>
    );
  }

  // --- PETALS / ROSE ANIMATION ---
  if (type === 'rose') {
    return (
       <div className="absolute inset-0 overflow-hidden bg-zinc-950 pointer-events-none z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-rose-950/20 to-black" />
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: -50, x: Math.random() * 100 + 'vw', rotate: 0, opacity: 0 }}
              animate={{ 
                y: '110vh', 
                x: `${(Math.random() * 100) + (Math.sin(i) * 10)}vw`,
                rotate: 360,
                opacity: [0, 0.6, 0] 
              }}
              transition={{ duration: Math.random() * 10 + 10, repeat: Infinity, delay: i * 2 }}
              className="absolute text-rose-500/30"
            >
               <div className="w-4 h-4 rounded-full bg-current blur-[2px]" />
            </motion.div>
          ))}
       </div>
    );
  }

  // --- LIVE VIDEO WALLPAPERS ---
  if (typeof type === 'string' && type.startsWith('video:')) {
     const url = type.split('video:')[1];
     return (
       <div className="absolute inset-0 bg-black overflow-hidden pointer-events-none z-0">
          <motion.div 
            animate={{ scale: reactiveScale }}
            transition={{ duration: 0.1 }}
            className="absolute inset-0 w-full h-full"
          >
            <video 
              key={url}
              autoPlay 
              loop 
              muted 
              playsInline 
              className="absolute inset-0 w-full h-full object-cover opacity-60"
              style={{ borderRadius: 0 }}
            >
               <source src={url} type="video/mp4" />
            </video>
          </motion.div>
          {/* VIGNETTE & BLENDING GRADIENT */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60 shadow-inner" />
          <div className="absolute inset-0 backdrop-blur-[1px] opacity-30" />
          {/* REACTIVE LIGHT OVERLAY */}
          <motion.div 
            animate={{ opacity: audioLevel * 0.3 }}
            className="absolute inset-0 bg-primary/20 mix-blend-overlay"
          />
       </div>
     );
  }

  // DEFAULT STATIC IMAGE (Original)
  return (
    <div 
      className="absolute inset-0 z-0 opacity-40 pointer-events-none"
      style={{ backgroundImage: `url(${type})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    />
  );
};
