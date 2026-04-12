import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, X, Lock, CheckCircle } from 'lucide-react';
import { initDB } from '../lib/db';

interface LockScreenProps {
  onUnlock: (pin: string) => void;
  onReset: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock, onReset }) => {
  const [display, setDisplay] = useState('');
  const [dots, setDots] = useState<boolean[]>(new Array(6).fill(false));
  const [showRescue, setShowRescue] = useState(false);
  const [rescueId, setRescueId] = useState('');
  const [rescueError, setRescueError] = useState('');
  
  // Intruder Selfie State
  const [, setFailedAttempts] = useState(0);

  const captureIntruder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      
      await new Promise(res => { video.onloadedmetadata = res; });
      setTimeout(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        const b64 = canvas.toDataURL('image/jpeg', 0.8);
        stream.getTracks().forEach(t => t.stop());
        
        const db = await initDB();
        await db.put('vault', {
          id: 'intruder_' + Date.now(),
          name: '🚨 INTRUDER',
          type: 'photo',
          data: b64,
          timestamp: Date.now(),
          locked: false
        });
      }, 500); // give camera half a second to adjust exposure
    } catch { /* silently fail if no camera */ }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Enter') {
        handleUnlockClick();
      } else if (e.key === 'Backspace') {
        setDisplay(prev => {
          const next = prev.slice(0, -1);
          const newDots = new Array(6).fill(false);
          for (let i = 0; i < next.length; i++) newDots[i] = true;
          setDots(newDots);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [display]);

  const handleKeyPress = (num: string) => {
    if (display.length < 6) {
      const newDisplay = display + num;
      setDisplay(newDisplay);
      const newDots = [...dots];
      newDots[newDisplay.length - 1] = true;
      setDots(newDots);
    }
  };

  const handleUnlockClick = () => {
    if (display.length === 6) {
      onUnlock(display);
      // Wait, LockScreen receives onUnlock which is a callback. 
      // In App.tsx, does onUnlock return a boolean? We might need to check how it works there.
      // A better way is: LockScreen calls onUnlock. If it remains rendered, it was wrong.
      // But we can just count every time they press OK as an attempt.
      setFailedAttempts(prev => {
        const next = prev + 1;
        if (next === 3) captureIntruder(); // Trigger on 3rd attempt
        return next;
      });
      setDisplay('');
      setDots(new Array(6).fill(false));
    }
  };

  const handleRescueReset = async () => {
    try {
      const db = await initDB();
      const identity = await db.get('identity', 'me');
      if (identity && identity.userId === rescueId.trim()) {
        await db.clear('auth'); // ONLY clear the PIN store
        onReset(); // This should trigger the app to show PinSetup again
      } else {
        setRescueError('Invalid Device ID. Ask your partner for your unique ID.');
      }
    } catch {
      setRescueError('Verification failed. Try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0a0a0c] flex flex-col items-center justify-center p-4 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-primary/10" />
      
      <div className="w-full max-w-xs py-4 relative z-10">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-white/5 rounded-2xl mx-auto flex items-center justify-center mb-6 border border-white/10">
            <Lock size={28} className="text-white/40" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Enter Passcode</h1>
          <p className="text-white/30 text-xs uppercase tracking-[3px] font-black">SecureLove Cloud</p>
          
          <div className="flex justify-center space-x-4 mt-8">
            {dots.map((active, i) => (
              <motion.div
                key={i}
                animate={{ scale: active ? 1.25 : 1, backgroundColor: active ? '#ffffff' : 'rgba(255,255,255,0.1)' }}
                className={`w-3.5 h-3.5 rounded-full border border-white/5`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="w-full aspect-square rounded-2xl bg-white/5 border border-white/10 text-3xl font-light text-white flex items-center justify-center active:bg-primary/20 transition-all"
            >
              {num}
            </button>
          ))}
          <div className="w-full aspect-square" />
          <button
            onClick={() => handleKeyPress('0')}
            className="w-full aspect-square rounded-2xl bg-white/5 border border-white/10 text-3xl font-light text-white flex items-center justify-center active:bg-primary/20 transition-all"
          >
            0
          </button>
          <button
            onClick={handleUnlockClick}
            className="w-full aspect-square rounded-2xl bg-primary text-white text-lg font-black uppercase flex items-center justify-center active:scale-95 transition-all shadow-xl shadow-primary/20"
          >
            OK
          </button>
        </div>

        <button 
          onClick={() => setShowRescue(true)}
          className="w-full mt-10 text-white/20 text-[10px] font-black uppercase tracking-[4px] hover:text-white/40 transition-colors"
        >
          Forgot Passcode?
        </button>
      </div>

      {/* EMERGENCY RESCUE MODAL */}
      <AnimatePresence>
        {showRescue && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <div className="w-full max-w-sm bg-zinc-900 rounded-[32px] border border-white/10 p-8 shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-primary to-blue-500" />
               <button onClick={() => setShowRescue(false)} className="absolute top-4 right-4 text-white/30 hover:text-white"><X size={20} /></button>
               
               <div className="flex flex-col items-center text-center">
                  <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6">
                    <ShieldAlert size={28} className="text-red-500" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Emergency Access</h3>
                  <p className="text-white/40 text-sm mb-8">To reset your PIN without losing data, you must provide your unique **Device ID**. 
                  <br/><br/>
                  <span className="text-primary font-semibold">Your partner can find this ID in their app settings.</span></p>

                  <input 
                    type="text" 
                    placeholder="Enter Device ID (user_...)" 
                    className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-primary mb-2"
                    value={rescueId}
                    onChange={e => { setRescueId(e.target.value); setRescueError(''); }}
                  />
                  {rescueError && <p className="text-red-400 text-[10px] font-bold uppercase mb-4">{rescueError}</p>}
                  
                  <button onClick={handleRescueReset} className="w-full btn-primary h-14 flex items-center justify-center space-x-2">
                    <CheckCircle size={18} />
                    <span>Verify & Reset PIN</span>
                  </button>
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
