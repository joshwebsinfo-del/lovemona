
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, AlertTriangle, Download, Smartphone, Share2 } from 'lucide-react';
import { initDB } from '../lib/db';

export const PanicScreen: React.FC = () => {
  const [confirming, setConfirming] = useState(false);
  const [nuking, setNuking] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const deferredPrompt = useRef<any>(null);

  useEffect(() => {
    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    // Detect if already installed as PWA
    const installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(installed);

    // Cache the install prompt for Android/Chrome
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt.current) {
      deferredPrompt.current.prompt();
      const { outcome } = await deferredPrompt.current.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        deferredPrompt.current = null;
      }
    }
  };

  const performNuke = async () => {
    setNuking(true);
    try {
      const db = await initDB();
      await db.clear('messages');
      await db.clear('vault');
      await db.clear('identity');
      await db.clear('partner');
      await db.clear('auth');
      localStorage.clear();
      setTimeout(() => {
        window.location.replace('https://www.google.com/search?q=weather+today');
      }, 1000);
    } catch (e) {
      console.error(e);
      window.location.replace('https://www.google.com/search?q=weather+today');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] no-scrollbar overflow-y-auto px-6">

      <div className="pt-20 text-center">
        <div className="w-24 h-24 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <ShieldAlert size={48} className="text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">Panic Mode</h1>
        <p className="text-sm text-white/50 leading-relaxed mb-6">
          If you are in danger or being forced to show your phone, you can instantly nuke all local data.
        </p>
      </div>

      {/* ── INSTALL SECTION (always visible) ── */}
      <div className="mb-6">
        {isInstalled ? (
          <div className="border border-green-500/20 bg-green-500/5 rounded-3xl p-5 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center shrink-0">
              <Smartphone size={24} className="text-green-400" />
            </div>
            <div>
              <p className="text-green-400 font-semibold text-sm">App Installed ✓</p>
              <p className="text-white/40 text-xs mt-0.5">SecureLove is on your home screen</p>
            </div>
          </div>
        ) : isIOS ? (
          /* iOS: show manual install instructions permanently */
          <div className="border border-primary/20 bg-primary/5 rounded-3xl p-5">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Download size={20} className="text-primary" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Install SecureLove</p>
                <p className="text-white/40 text-xs">Add to your iPhone home screen</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { icon: <Share2 size={16} />, text: 'Tap the Share icon at the bottom of Safari' },
                { icon: <Download size={16} />, text: 'Scroll down and tap "Add to Home Screen"' },
                { icon: <Smartphone size={16} />, text: 'Tap "Add" — the app icon will appear on your home screen' },
              ].map((step, i) => (
                <div key={i} className="flex items-start space-x-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary mt-0.5">
                    {step.icon}
                  </div>
                  <p className="text-white/60 text-[13px] leading-relaxed">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Android / Chrome: show install button permanently */
          <button
            onClick={handleInstall}
            className="w-full flex items-center justify-center space-x-3 h-16 rounded-3xl font-bold text-base bg-gradient-to-r from-primary to-rose-600 text-white shadow-lg shadow-primary/30 active:scale-95 transition-all"
          >
            <Download size={22} />
            <span>Install SecureLove App</span>
          </button>
        )}
      </div>

      {/* ── NUKE CARD ── */}
      <div className="bg-red-500/10 border border-red-500/20 rounded-3xl p-6 mb-8">
        <h3 className="text-red-400 font-semibold mb-3 flex items-center text-sm">
          <AlertTriangle size={16} className="mr-2" /> What happens when nuked?
        </h3>
        <ul className="space-y-3">
          {[
            'All chat history is permanently wiped.',
            'The Secure Vault and its contents are destroyed.',
            'Cryptographic identities and partner keys are deleted.',
            'The app will look like it was never installed.',
          ].map((text, i) => (
            <li key={i} className="flex items-start text-[13px] text-white/60">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 mr-3 shrink-0" />
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pb-32">
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="w-full h-16 bg-red-500/10 text-red-500 border border-red-500 rounded-2xl font-semibold text-lg hover:bg-red-500 hover:text-white transition-colors active:scale-95"
          >
            Initiate Nuke Protocol
          </button>
        ) : (
          <AnimatePresence>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <button
                onClick={performNuke}
                disabled={nuking}
                className="w-full h-16 bg-red-500 text-white rounded-2xl font-bold text-lg shadow-2xl shadow-red-500/30 flex items-center justify-center"
              >
                {nuking ? 'Sanitizing Device...' : 'CONFIRM: NUKE EVERYTHING'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={nuking}
                className="w-full h-14 bg-white/5 text-white/50 rounded-2xl font-medium"
              >
                Cancel
              </button>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

    </div>
  );
};
