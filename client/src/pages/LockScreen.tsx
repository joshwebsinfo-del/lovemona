
import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface LockScreenProps {
  onUnlock: (pin: string) => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [display, setDisplay] = useState('');
  const [dots, setDots] = useState<boolean[]>(new Array(6).fill(false));

  const handleKeyPress = (num: string) => {
    if (display.length < 6) {
      const newDisplay = display + num;
      setDisplay(newDisplay);
      
      const newDots = [...dots];
      newDots[newDisplay.length - 1] = true;
      setDots(newDots);

      if (newDisplay.length === 6) {
        // Just provide feedback, don't auto-unlock to avoid race conditions with OK button
      }
    }
  };



  const handleUnlockClick = () => {
    if (display.length === 6) {
      onUnlock(display);
      setDisplay('');
      setDots(new Array(6).fill(false));
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0c111d] flex flex-col items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-xs py-4">
        <div className="text-center mb-8">
          <h1 className="text-lg font-medium text-white/40 tracking-wider mb-4">SecureCalc</h1>
          <h2 className="text-xl font-semibold text-white mb-6">Enter Passcode</h2>
          <div className="flex justify-center space-x-3 mb-2">
            {dots.map((active, i) => (
              <motion.div
                key={i}
                initial={{ scale: 1 }}
                animate={{ scale: active ? 1.2 : 1 }}
                className={`w-2.5 h-2.5 rounded-full border border-white/20 ${active ? 'bg-white' : 'bg-transparent'}`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-3 gap-y-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="w-full aspect-square rounded-xl bg-white/5 border border-white/5 text-3xl font-light text-white flex items-center justify-center active:bg-white/10 active:scale-95 transition-all"
            >
              {num}
            </button>
          ))}
          <div className="w-full aspect-square" />
          <button
            onClick={() => handleKeyPress('0')}
            className="w-full aspect-square rounded-xl bg-white/5 border border-white/5 text-3xl font-light text-white flex items-center justify-center active:bg-white/10 active:scale-95 transition-all"
          >
            0
          </button>
          <button
            onClick={handleUnlockClick}
            className="w-full aspect-square rounded-xl bg-white/5 border border-white/5 text-xl font-medium text-white/50 flex items-center justify-center active:bg-white/10 active:scale-95 transition-all"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
