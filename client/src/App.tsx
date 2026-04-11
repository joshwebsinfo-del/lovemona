

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Shield, AlertTriangle, User } from 'lucide-react';
import { DashboardScreen } from './pages/DashboardScreen';
import { ChatScreen } from './pages/ChatScreen';
import { VaultScreen } from './pages/VaultScreen';
import { PanicScreen } from './pages/PanicScreen';
import { LockScreen } from './pages/LockScreen';
import { SetupScreen } from './pages/SetupScreen';
import { PinSetupScreen } from './pages/PinSetupScreen';
import { SettingsScreen } from './pages/SettingsScreen';
import { initDB } from './lib/db';
import type { AuthConfig } from './lib/types';

// ──────────────────────────────────────────────
// Bottom navigation
// ──────────────────────────────────────────────
const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { id: 'home',  label: 'Hub',   icon: User,           path: '/' },
    { id: 'chat',  label: 'Chat',  icon: MessageCircle,  path: '/chat' },
    { id: 'vault', label: 'Vault', icon: Shield,         path: '/vault' },
    { id: 'panic', label: 'Panic', icon: AlertTriangle,  path: '/panic' },
  ];

  return (
    <div className="glass fixed bottom-0 w-full h-20 px-6 flex items-center justify-around z-30">
      {navItems.map(({ id, label, icon: Icon, path }) => {
        const active = location.pathname === path;
        return (
          <button
            key={id}
            onClick={() => navigate(path)}
            className={`flex flex-col items-center space-y-1 transition-all ${active ? 'text-primary scale-110' : 'text-white/40'}`}
          >
            <Icon size={24} strokeWidth={active ? 2.5 : 2} />
            <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

// ──────────────────────────────────────────────
// Fake Calculator (shown on decoy PIN)
// ──────────────────────────────────────────────
const FakeCalculator = () => (
  <div className="flex flex-col items-center justify-center h-full p-10 text-center select-none">
    <h2 className="text-2xl font-bold text-white/20">Calculator</h2>
    <p className="text-white/10 mt-1 text-sm italic mb-6">Basic calculator mode</p>
    <div className="grid grid-cols-4 gap-2 w-full max-w-xs opacity-20 grayscale">
      {[7,8,9,'÷',4,5,6,'×',1,2,3,'−','.',0,'=','+'].map((btn, i) => (
        <div key={i} className="h-14 border border-white/20 flex items-center justify-center rounded-xl text-white text-lg">
          {btn}
        </div>
      ))}
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Main app content
// ──────────────────────────────────────────────
const AppContent = () => {
  const [appConfig, setAppConfig] = useState<AuthConfig | null>(null);

  const [isUnlocked, setIsUnlocked]   = useState(true);
  const [isFakeMode, setIsFakeMode]   = useState(false);
  const [isPaired,   setIsPaired]     = useState(false);
  const [isLoading,  setIsLoading]    = useState(true);

  const location = useLocation();

  // Load config and pairing status from IndexedDB on mount
  useEffect(() => {
    const load = async () => {
      try {
        const db = await initDB();
        const [config, partner] = await Promise.all([
          db.get('auth', 'pins'),
          db.get('partner', 'partner'),
        ]);

        if (config) {
          setAppConfig(config);
        } else {
          const devConfig: AuthConfig = { id: 'pins', realPin: '123456', fakePin: '000000', nickname: 'DevUser' };
          await db.put('auth', devConfig);
          setAppConfig(devConfig);
        }
        if (partner) setIsPaired(true);
      } catch (err) {
        console.error('Failed to load app config:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();

    // Inactivity Auto-Lock (Privacy Improvement #1)
    let lockTimeout: ReturnType<typeof setTimeout>;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Lock after 1 minute of being hidden
        lockTimeout = setTimeout(() => {
          setIsUnlocked(false);
          setIsFakeMode(false);
        }, 60000); 
      } else {
        clearTimeout(lockTimeout);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const handlePinSetupComplete = async (realPin: string, fakePin: string, nickname: string, avatar?: string) => {
    const config = { id: 'pins', realPin, fakePin, nickname, avatar };
    const db = await initDB();
    await db.put('auth', config);
    setAppConfig(config);
  };

  const handleUnlock = (pin: string) => {
    if (!appConfig) return;

    // Proactively request camera permission during this user gesture
    navigator.mediaDevices?.getUserMedia({ video: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});

    if (pin === appConfig.realPin) {
      setIsUnlocked(true);
      setIsFakeMode(false);
    } else if (appConfig.fakePin && pin === appConfig.fakePin) {
      setIsUnlocked(true);
      setIsFakeMode(true);
    }
    // wrong PIN → do nothing (lock screen stays)
  };

  // 1. Loading
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0c] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // 2. First launch → PIN setup
  if (!appConfig) {
    return <PinSetupScreen 
      onComplete={handlePinSetupComplete} 
      onRestore={() => window.location.reload()} 
    />;
  }

  // 3. Lock screen
  if (!isUnlocked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  // 4. Pairing screen (first time)
  if (!isPaired && !isFakeMode && appConfig) {
    return <SetupScreen config={appConfig} onPair={() => setIsPaired(true)} />;
  }

  // 5. Main app
  return (
    <div className="h-screen w-full bg-background overflow-hidden flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname + (isFakeMode ? '-fake' : '')}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="absolute inset-0"
          >
            {isFakeMode ? (
              <FakeCalculator />
            ) : (
              <Routes location={location}>
                <Route path="/"       element={<DashboardScreen />} />
                <Route path="/chat"   element={<ChatScreen />} />
                <Route path="/vault"  element={<VaultScreen />} />
                <Route path="/panic"  element={<PanicScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
              </Routes>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      {!isFakeMode && <BottomNav />}
    </div>
  );
};

// ──────────────────────────────────────────────
export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
