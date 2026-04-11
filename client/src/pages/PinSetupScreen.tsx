
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Lock, Loader2, CloudDownload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { initDB } from '../lib/db';

interface PinSetupProps {
  onComplete: (realPin: string, fakePin: string, nickname: string, avatar?: string) => void;
  onRestore?: () => void;
}

export const PinSetupScreen: React.FC<PinSetupProps> = ({ onComplete, onRestore }) => {
  const [step, setStep] = useState<'nickname' | 'real' | 'fakeWarn' | 'fake' | 'restore'>('nickname');
  const [nickname, setNickname] = useState('');
  const [realPin, setRealPin] = useState('');
  const [fakePin, setFakePin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [avatar, setAvatar] = useState<string>('');
  
  const [restoreId, setRestoreId] = useState('');
  const [restorePin, setRestorePin] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 800; // Good quality but small size
        let { width, height } = img;
        if (width > height && width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        setAvatar(canvas.toDataURL('image/jpeg', 0.8));
      };
    };
    reader.readAsDataURL(file);
  };

  const handleNicknameNext = () => {
    if (nickname.trim().length < 1) { setError('Please enter a name.'); return; }
    setError('');
    setStep('real');
  };

  const handleRealPin = () => {
    if (realPin.length < 4) { setError('PIN must be at least 4 digits.'); return; }
    if (realPin !== confirm) { setError('PINs do not match.'); return; }
    setError('');
    setConfirm('');
    setStep('fakeWarn');
  };

  const handleFakePin = () => {
    if (fakePin.length < 4) { setError('Fake PIN must be at least 4 digits.'); return; }
    if (fakePin === realPin) { setError('Fake PIN cannot be the same as your real PIN.'); return; }
    setError('');
    onComplete(realPin, fakePin, nickname.trim(), avatar);
  };

  const handleRestore = async () => {
    if (!restoreId || !restorePin) { setError('Please enter both.'); return; }
    setIsRestoring(true);
    setError('');
    
    try {
       const { data: user } = await supabase.from('users').select('*').eq('user_id', restoreId).single();
       if (!user || user.real_pin !== restorePin) {
           setError('Invalid Device ID or Secret PIN.');
           setIsRestoring(false);
           return;
       }
       
       const config = { id: 'pins', realPin: user.real_pin, fakePin: user.fake_pin, nickname: user.nickname, avatar: user.avatar };
       const identity = { id: 'me', userId: user.user_id, publicKeyPem: user.public_key, privateKey: user.private_key };
       
       const db = await initDB();
       await db.put('auth', config);
       await db.put('identity', identity);

       const { data: part } = await supabase.from('partnerships').select('*').eq('user_id', user.user_id).single();
       if (part) {
           await db.put('partner', {
              id: 'partner',
              userId: part.partner_id,
              publicKeyPem: part.partner_public_key,
              nick: part.partner_nickname,
              avatar: part.partner_avatar
           });
       }

       if (onRestore) onRestore();
    } catch {
       setError('Cloud connection failed.');
       setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0a0a0c] flex flex-col items-center justify-center p-6 z-50">
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Icon */}
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Lock size={36} className="text-primary" />
          </div>
        </div>

        {/* STEP: Nickname & Avatar */}
        {step === 'nickname' && (
          <>
            <h1 className="text-2xl font-bold text-white text-center mb-2">Welcome to SecureLove</h1>
            <p className="text-white/40 text-sm text-center mb-6">Set a profile picture and nickname your partner will see.</p>
            
            <div className="flex justify-center mb-6">
               <label className="relative cursor-pointer group">
                  <div className={`w-28 h-28 rounded-full border-2 border-dashed border-white/20 flex flex-col items-center justify-center overflow-hidden transition-all ${avatar ? 'border-primary border-solid' : 'hover:border-white/50'}`}>
                     {avatar ? (
                        <img src={avatar} className="w-full h-full object-cover" alt="avatar" />
                     ) : (
                        <div className="text-white/30 flex flex-col items-center text-xs">
                           <Lock size={24} className="mb-1" />
                           Add Photo
                        </div>
                     )}
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
               </label>
            </div>

            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-lg text-center outline-none focus:border-primary/50 mb-3"
              placeholder="e.g. My Love ❤️"
              value={nickname}
              onChange={e => { setNickname(e.target.value); setError(''); }}
              maxLength={24}
              autoFocus
            />
            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
            <button onClick={handleNicknameNext} className="w-full btn-primary h-14 mt-2">
              Continue
            </button>
            <button onClick={() => { setStep('restore'); setError(''); }} className="w-full h-14 mt-4 bg-white/5 border border-white/10 text-white/60 font-semibold rounded-2xl flex items-center justify-center space-x-2 active:scale-95 transition-all">
               <CloudDownload size={18} />
               <span>Restore from Cloud</span>
            </button>
          </>
        )}

        {/* STEP: Real PIN */}
        {step === 'real' && (
          <>
            <h1 className="text-2xl font-bold text-white text-center mb-2">Set Your Secret PIN</h1>
            <p className="text-white/40 text-sm text-center mb-8">This unlocks the real app. At least 4 digits.</p>
            
            <div className="relative mb-3">
              <input
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-2xl text-center tracking-widest outline-none focus:border-primary/50 pr-12"
                placeholder="••••••"
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                value={realPin}
                onChange={e => { setRealPin(e.target.value.replace(/\D/g, '')); setError(''); }}
                maxLength={8}
              />
              <button onClick={() => setShow(!show)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30">
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-2xl text-center tracking-widest outline-none focus:border-primary/50 mb-3"
              placeholder="Confirm PIN"
              type="password"
              inputMode="numeric"
              value={confirm}
              onChange={e => { setConfirm(e.target.value.replace(/\D/g, '')); setError(''); }}
              maxLength={8}
            />
            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
            <button onClick={handleRealPin} className="w-full btn-primary h-14 mt-2">
              Set Secret PIN
            </button>
          </>
        )}

        {/* STEP: Fake PIN warning */}
        {step === 'fakeWarn' && (
          <>
            <h1 className="text-2xl font-bold text-white text-center mb-2">Add a Decoy PIN</h1>
            <p className="text-white/40 text-sm text-center mb-8 px-4">
              If someone forces you to unlock the app, enter this PIN instead. It opens a fake empty calculator.
            </p>
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-6">
              <p className="text-amber-400 text-sm text-center">🛡️ Your real data stays hidden when the decoy PIN is used.</p>
            </div>
            <button onClick={() => setStep('fake')} className="w-full btn-primary h-14 mb-3">
              Set Decoy PIN
            </button>
            <button
              onClick={() => onComplete(realPin, '', nickname.trim(), avatar)}
              className="w-full py-4 text-white/40 text-sm"
            >
              Skip for now
            </button>
          </>
        )}

        {/* STEP: Fake PIN */}
        {step === 'fake' && (
          <>
            <h1 className="text-2xl font-bold text-white text-center mb-2">Set Decoy PIN</h1>
            <p className="text-white/40 text-sm text-center mb-8">This must be different from your real PIN.</p>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-2xl text-center tracking-widest outline-none focus:border-amber-500/50 mb-3"
              placeholder="••••••"
              type="password"
              inputMode="numeric"
              value={fakePin}
              onChange={e => { setFakePin(e.target.value.replace(/\D/g, '')); setError(''); }}
              maxLength={8}
              autoFocus
            />
            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
            <button onClick={handleFakePin} className="w-full btn-primary h-14 mt-2">
              Save Decoy PIN
            </button>
          </>
        )}

        {/* STEP: Cloud Restore */}
        {step === 'restore' && (
          <>
            <h1 className="text-2xl font-bold text-white text-center mb-2">Cloud Recovery</h1>
            <p className="text-white/40 text-sm text-center mb-8">Restore your entire account and messages safely from your Supabase Cloud.</p>
            
            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-center tracking-widest outline-none focus:border-primary/50 mb-3"
              placeholder="Device ID (user_...)"
              value={restoreId}
              onChange={e => { setRestoreId(e.target.value); setError(''); }}
              autoFocus
            />
            
            <div className="relative mb-3">
               <input
                 className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white text-center tracking-widest outline-none focus:border-primary/50"
                 placeholder="Secret PIN"
                 type={show ? 'text' : 'password'}
                 inputMode="numeric"
                 value={restorePin}
                 onChange={e => { setRestorePin(e.target.value.replace(/\D/g, '')); setError(''); }}
                 maxLength={8}
               />
               <button onClick={() => setShow(!show)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30">
                 {show ? <EyeOff size={18} /> : <Eye size={18} />}
               </button>
            </div>
            
            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
            
            <button onClick={handleRestore} disabled={isRestoring} className="w-full btn-primary h-14 mt-2 flex items-center justify-center space-x-2">
              {isRestoring ? <Loader2 className="animate-spin text-white" size={20} /> : (
                 <>
                    <CloudDownload size={18} />
                    <span>Restore Identity</span>
                 </>
              )}
            </button>
            
            <button onClick={() => { setStep('nickname'); setError(''); }} className="w-full py-4 text-white/40 text-sm mt-2">
              Cancel
            </button>
          </>
        )}

        {/* Progress dots */}
        <div className="flex justify-center space-x-2 mt-8">
          {step !== 'restore' && ['nickname', 'real', 'fakeWarn', 'fake'].map((s) => (
            <div key={s} className={`w-1.5 h-1.5 rounded-full transition-all ${s === step ? 'bg-primary w-4' : 'bg-white/20'}`} />
          ))}
        </div>
      </motion.div>
    </div>
  );
};
