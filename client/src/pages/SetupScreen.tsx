
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QrCode, Camera, RefreshCw, ShieldCheck, ArrowLeft, Loader2, AlertCircle, Share2, Zap, Heart, Lock, Shield, ChevronRight, Download, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { initSocket } from '../lib/socket';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { generateKeyPair, exportPublicKey } from '../lib/crypto';
import type { Partner, AuthConfig } from '../lib/types';
import type { Socket } from 'socket.io-client';
import { useNotifications } from '../components/NotificationProvider';

interface SetupScreenProps {
  onPair: (partner: Partner) => void;
  config: AuthConfig;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onPair, config }) => {
  const { showNotification } = useNotifications();
  const [pushStatus, setPushStatus] = useState<'prompt' | 'loading' | 'active' | 'denied' | 'unsupported'>('prompt');
  const [mode, setMode] = useState<'decision' | 'show' | 'scan' | 'manual'>('decision');
  const [myId, setMyId] = useState<string>('');
  const [publicKey, setPublicKey] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isServerOffline, setIsServerOffline] = useState(false);
  const [scanStatus, setScanStatus] = useState<'scanning' | 'found'>('scanning');
  const [enteredPartnerId, setEnteredPartnerId] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const connectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isConnecting) {
      connectingTimeoutRef.current = setTimeout(() => {
        setIsConnecting(false);
        showNotification({ 
          title: 'Pairing Timeout', 
          message: 'Connection took too long. Please ensure your partner has their "Show My QR" screen open.', 
          type: 'alert' 
        });
      }, 15000);
    } else if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
    }
    return () => { if (connectingTimeoutRef.current) clearTimeout(connectingTimeoutRef.current); };
  }, [isConnecting]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const socketRef = useRef<Socket | null>(null);
  const myIdRef = useRef('');
  const publicKeyRef = useRef('');

  useEffect(() => { myIdRef.current = myId; }, [myId]);
  useEffect(() => { publicKeyRef.current = publicKey; }, [publicKey]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);  const handleManualConnect = () => {
    if (!enteredPartnerId) return;
    setIsConnecting(true);
    socketRef.current?.emit('pair:connect', {
      partnerId: enteredPartnerId,
      myId: myIdRef.current,
      publicKey: publicKeyRef.current,
      nick: config.nickname,
      avatar: config.avatar
    });
  };

  const handleAutoPair = async () => {
    try {
      setIsConnecting(true);
      const db = await initDB();
      const identity = await db.get('identity', 'me');
      if (!identity) throw new Error('Identity not found');

      const testPartnerId = 'test_' + crypto.randomUUID().split('-')[0];
      const testPartnerKeys = await generateKeyPair();
      const testPartnerPubKey = await exportPublicKey(testPartnerKeys.publicKey);
      
      const testPartnerData: Partner = {
        id: 'partner',
        userId: testPartnerId,
        publicKeyPem: testPartnerPubKey,
        nick: 'Test Partner',
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${testPartnerId}`
      };

      // 1. Register test partner in Supabase
      await supabase.from('users').insert({
        user_id: testPartnerId,
        nickname: testPartnerData.nick,
        avatar: testPartnerData.avatar,
        real_pin: '0000',
        fake_pin: '9999',
        public_key: testPartnerPubKey,
        private_key: testPartnerKeys.privateKey,
        created_at: Date.now()
      });

      // 2. Create partnership in Supabase
      await supabase.from('partnerships').insert({
        user_id: identity.userId,
        partner_id: testPartnerId,
        partner_public_key: testPartnerPubKey,
        partner_nickname: testPartnerData.nick,
        partner_avatar: testPartnerData.avatar,
        paired_at: Date.now()
      });

      // 3. Save locally
      await db.put('partner', testPartnerData);
      
      setTimeout(() => onPair(testPartnerData), 1000);
    } catch (err) {
      console.error('Auto-pair error:', err);
      setError('Auto-pair failed. Check Supabase connection.');
      setIsConnecting(false);
    }
  };

  function scanFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code) {
      try {
        const data = JSON.parse(code.data);
        if (data.userId && data.publicKey) {
          setScanStatus('found');
          stopCamera();
          setIsConnecting(true);
          socketRef.current?.emit('pair:connect', {
            partnerId: data.userId,
            myId: myIdRef.current,
            publicKey: publicKeyRef.current,
            nick: config.nickname,
            avatar: config.avatar
          });
          return;
        }
      } catch { /* ignored */ }
    }
    animFrameRef.current = requestAnimationFrame(scanFrame);
  }

  useEffect(() => {
    // Check if already installed
    setIsInstalled(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);
    
    // Check if iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    
    // Check initial push status
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
       setPushStatus('unsupported');
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const subscribeToPush = async () => {
    try {
      setPushStatus('loading');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus('denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      
      // VAPID Public Key from .env
      const vapidPublicKey = 'BGFQdFBv_xpe6nSmdZ7eEGtCIW8hJT_JudRtHfXca8QQPMgOn58gQbsc5-FNe4ibOmPk4H8PMgfbMuGduEN3eaI';
      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });

      const db = await initDB();
      const identity = await db.get('identity', 'me');
      if (!identity) throw new Error('No identity');

      const response = await fetch(`${window.location.origin}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: identity.userId,
          subscription: subscription
        })
      });

      if (response.ok) {
        setPushStatus('active');
        showNotification({ title: 'Notifications Active', message: 'You will now receive messages even when closed.', type: 'system' });
      } else {
        throw new Error('Server subscription failed');
      }
    } catch (err) {
      console.error('Push error:', err);
      setPushStatus('prompt');
      alert('Failed to enable remote notifications.');
    }
  };

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const handleInstallApp = async () => {
    if (!deferredPrompt) {
       showNotification({ 
         title: 'Manual Install', 
         message: 'To install MONA: 1. Tap the Share icon (iOS) or Menu (Android). 2. Select "Add to Home Screen".', 
         type: 'system' 
       });
       return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  useEffect(() => {
    const setupIdentity = async () => {
      try {
        setIsLoading(true);
        const db = await initDB();
        let identity = await db.get('identity', 'me');

        if (!identity) {
          const id = 'user_' + crypto.randomUUID().split('-')[0];
          const keys = await generateKeyPair();
          const pubKeyPem = await exportPublicKey(keys.publicKey);
          identity = { id: 'me', userId: id, publicKeyPem: pubKeyPem, privateKey: keys.privateKey };
          await db.put('identity', identity);
          
          await supabase.from('users').insert({
              user_id: id,
              nickname: config.nickname,
              avatar: config.avatar,
              real_pin: config.realPin,
              fake_pin: config.fakePin,
              public_key: pubKeyPem,
              private_key: keys.privateKey,
              created_at: Date.now()
          });
        }

        setMyId(identity.userId);
        setPublicKey(identity.publicKeyPem);
        myIdRef.current = identity.userId;
        publicKeyRef.current = identity.publicKeyPem;
        setIsLoading(false);

        const s = initSocket(identity.userId);
        socketRef.current = s;

        const registerWithServer = () => {
          console.log(`[Setup] Registering with server as ${identity.userId}`);
          s.emit('pair:init', { myId: identity.userId, publicKey: identity.publicKeyPem, nick: config.nickname, avatar: config.avatar });
          setIsServerOffline(false);
        };

        s.on('connect', registerWithServer);
        if (s.connected) registerWithServer();

        // Timeout to show "Offline" status
        setTimeout(() => {
          if (!s.connected) setIsServerOffline(true);
        }, 3000);
        
        s.on('disconnect', () => setIsServerOffline(true));

        s.off('pair:received').on('pair:received', async (data: { partnerId: string; publicKey: string; nick: string; avatar: string }) => {
          setIsConnecting(true);
          const db2 = await initDB();
          const partnerData: Partner = { id: 'partner', userId: data.partnerId, publicKeyPem: data.publicKey, nick: data.nick, avatar: data.avatar };
          await db2.put('partner', partnerData);
          
          await supabase.from('partnerships').insert({
              user_id: identity.userId,
              partner_id: data.partnerId,
              partner_public_key: data.publicKey,
              partner_nickname: data.nick,
              partner_avatar: data.avatar,
              paired_at: Date.now()
          });
          
          s.emit('pair:confirm', { to: data.partnerId, myId: identity.userId, publicKey: identity.publicKeyPem, nick: config.nickname, avatar: config.avatar });
          setTimeout(() => onPair(partnerData), 800);
        });

        s.off('pair:confirmed').on('pair:confirmed', async (data: { myId: string; publicKey: string; nick: string; avatar: string }) => {
           setIsConnecting(true);
           const db3 = await initDB();
           const partnerData: Partner = { id: 'partner', userId: data.myId, publicKeyPem: data.publicKey, nick: data.nick, avatar: data.avatar };
           await db3.put('partner', partnerData);
           setTimeout(() => onPair(partnerData), 800);
        });

      } catch (err) {
        console.error('Identity setup error:', err);
        setError('Setup failed. Please refresh the page.');
        setIsLoading(false);
      }
    };
    setupIdentity();

    return () => {
       socketRef.current?.disconnect();
    };
  }, [config.avatar, config.fakePin, config.nickname, config.realPin, onPair]);

  const startCamera = async () => {
    setScanStatus('scanning');
    setError(null);
    let stream: MediaStream | null = null;
    const constraints = [
      { video: { facingMode: 'environment' } },
      { video: true }
    ];

    for (const constraint of constraints) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraint);
        break;
      } catch (e) {
        console.warn('Camera constraint failed, trying next:', constraint, e);
      }
    }

    if (stream) {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        animFrameRef.current = requestAnimationFrame(scanFrame);
      }
    } else {
      setError('Could not access camera. Please check permissions.');
      setMode('decision');
    }
  };

  const handleModeChange = (newMode: 'decision' | 'show' | 'scan' | 'manual') => {
    if (mode === 'scan') stopCamera();
    setMode(newMode);
    if (newMode === 'scan') {
      setTimeout(startCamera, 100);
    }
  };

  const isLite = typeof navigator !== 'undefined' && (navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0a0a0c] p-10 text-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
        <h2 className="text-2xl font-bold text-white mb-2">Syncing with Cloud...</h2>
        <p className="text-white/40">Preparing your secure identity</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] safe-top safe-bottom p-6 overflow-hidden relative">
      {/* GLOWING BACKDROP */}
      {!isLite && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-primary/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-primary/5 blur-[120px] rounded-full" />
        </div>
      )}

      <AnimatePresence mode="wait">
        {mode === 'decision' && (
          <motion.div key="decision" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex flex-col h-full items-center justify-center text-center space-y-8 relative z-10">
            <div className="w-24 h-24 bg-primary/10 rounded-[32px] flex items-center justify-center border border-primary/20 shadow-2xl shadow-primary/20 relative group">
              <div className="absolute inset-0 bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <ShieldCheck size={48} className="text-primary relative z-10" />
            </div>
            
            <div className="space-y-3">
              <h1 className="text-4xl font-black text-white tracking-tighter">SECURE PAIR</h1>
              <p className="text-white/40 text-[15px] font-medium leading-relaxed max-w-xs mx-auto">
                Connect your heart and your device to your partner's through an end-to-end encrypted line.
              </p>
            </div>

            {/* ── INSTALL SECTION (Permanent) ── */}
            {!isInstalled && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full bg-white/5 border border-white/10 rounded-[32px] p-6 space-y-4 mb-2"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Zap className="text-primary" size={24} />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm">Install SecureLove</h3>
                    <p className="text-white/40 text-[11px]">Recommended for high-priority notifications</p>
                  </div>
                </div>

                {isIOS ? (
                  <div className="space-y-3 bg-black/20 rounded-2xl p-4">
                    <p className="text-[10px] text-white/60 leading-relaxed">
                      1. Tap the <span className="text-white font-bold inline-flex items-center"><Share2 size={12} className="mx-1" /> Share</span> icon below.
                      <br />
                      2. Scroll down and select <span className="text-white font-bold">"Add to Home Screen"</span>.
                    </p>
                  </div>
                ) : (
                  <button 
                    onClick={handleInstallApp}
                    className="w-full bg-white text-black h-12 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary hover:text-white transition-all active:scale-95 flex items-center justify-center space-x-2"
                  >
                    <Download size={16} />
                    <span>Install Now</span>
                  </button>
                )}
              </motion.div>
            )}

            {isServerOffline && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-full flex items-center space-x-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">Secure Server Unreachable – Establishing Link...</span>
              </motion.div>
            )}

            <div className="w-full space-y-4 pt-4">
              <button 
                onClick={() => { if(navigator.vibrate) navigator.vibrate(10); handleModeChange('show'); }} 
                className="w-full h-16 bg-white text-black rounded-[24px] font-black text-lg shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95 transition-all flex items-center justify-center space-x-3"
              >
                <QrCode size={24} />
                <span>Show My QR</span>
              </button>
              <button 
                onClick={() => { if(navigator.vibrate) navigator.vibrate(10); handleModeChange('scan'); }} 
                className="w-full h-16 bg-zinc-900 text-white rounded-[24px] font-black text-lg border border-white/10 hover:bg-zinc-800 active:scale-95 transition-all flex items-center justify-center space-x-3"
              >
                <Camera size={24} className="text-primary" />
                <span>Scan Partner's</span>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => { if(navigator.vibrate) navigator.vibrate(5); handleModeChange('manual'); }} 
                  className="h-14 bg-white/5 text-white/60 rounded-[20px] font-bold text-xs border border-white/5 hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center space-x-2"
                >
                  <Zap size={16} />
                  <span>Manual ID</span>
                </button>
                <button 
                  onClick={async () => {
                    if(navigator.vibrate) navigator.vibrate(20);
                    try {
                      await navigator.share({
                        title: 'SecureLove Link',
                        text: `Establish a secure connection with me on SecureLove. My ID: ${myId}`,
                        url: window.location.href
                      });
                    } catch {
                      navigator.clipboard.writeText(myId);
                      showNotification({ title: 'Discovery ID', message: 'Identifier copied to clipboard. Share with partner!', type: 'success' });
                    }
                  }} 
                  className="h-14 bg-primary/10 text-primary rounded-[20px] font-bold text-xs border border-primary/20 hover:bg-primary/20 active:scale-95 transition-all flex items-center justify-center space-x-2"
                >
                  <Share2 size={16} />
                  <span>Invite Partner</span>
                </button>
              </div>
              
              <div className="pt-4 flex flex-col items-center">
                 <span className="text-[10px] font-black uppercase tracking-[2px] text-white/20 mb-2">My Secure Device Fingerprint</span>
                 <div className="px-4 py-2 bg-white/5 rounded-xl border border-white/10 flex items-center space-x-3">
                    <span className="text-xs font-mono text-primary/80">{myId}</span>
                 </div>
              </div>

              {/* FEATURE CAROUSEL */}
              <div className="pt-8 w-full space-y-8">
                <button 
                  onClick={handleInstallApp}
                  className="w-full h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-[24px] border border-primary/20 flex items-center justify-between px-6 group active:scale-95 transition-all"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
                      <Share2 size={20} />
                    </div>
                    <div className="text-left">
                      <div className="text-[10px] font-black uppercase tracking-wider text-primary">Permanent Access</div>
                      <div className="text-[13px] font-bold text-white">Install MONA Mobile</div>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/20 group-hover:text-primary transition-colors" />
                </button>

                <div className="space-y-4">
                  <h3 className="text-white/60 text-[10px] font-black uppercase tracking-[0.2em] ml-4 text-left">Advanced Connectivity</h3>
                  
                  {/* Remote Notifications Card */}
                  <div className="bg-white/5 border border-white/10 rounded-[24px] p-5 space-y-5 text-left">
                     <div className="flex items-start space-x-4">
                       <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
                          <Zap size={20} />
                       </div>
                       <div className="flex-1">
                          <p className="text-white text-sm font-bold">Always-Active Mode</p>
                          <p className="text-white/40 text-[10px] leading-relaxed mt-1 italic">Stay connected even when the app is completely closed. Receive instant pings and location alerts.</p>
                       </div>
                     </div>
                     
                     {pushStatus === 'active' ? (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 flex items-center space-x-2">
                           <ShieldCheck size={14} className="text-green-500" />
                           <span className="text-green-500 text-[10px] font-bold uppercase tracking-wider">Background Sync Active</span>
                        </div>
                     ) : pushStatus === 'unsupported' ? (
                        <p className="text-red-400/60 text-[10px] text-center italic">Background push not supported on this browser.</p>
                     ) : (
                       <button 
                         onClick={subscribeToPush}
                         disabled={pushStatus === 'loading'}
                         className="w-full bg-indigo-600 hover:bg-indigo-500 py-3 rounded-xl text-white text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-50"
                       >
                         {pushStatus === 'loading' ? 'Activating...' : 'Enable Always-Active'}
                       </button>
                     )}
                  </div>
                </div>

                <div className="flex space-x-4 overflow-x-auto no-scrollbar pb-2">
                  {[
                    { icon: <Shield size={16}/>, title: 'E2E Encryption', desc: 'True privacy' },
                    { icon: <Lock size={16}/>, title: 'Secret Vault', desc: 'Secure memories' },
                    { icon: <Heart size={16}/>, title: 'Mood Sync', desc: 'Feel together' }
                  ].map((feat, i) => (
                    <div key={i} className="flex-shrink-0 w-32 bg-white/5 rounded-2xl p-3 border border-white/5 text-left">
                       <div className="text-primary mb-2">{feat.icon}</div>
                       <div className="text-[10px] font-black text-white uppercase tracking-wider">{feat.title}</div>
                       <div className="text-[8px] text-white/30 font-bold uppercase">{feat.desc}</div>
                     </div>
                  ))}
                </div>
              </div>

              <div className="pt-8 flex flex-col items-center">
                 <button 
                    onClick={handleAutoPair}
                    className="text-[10px] font-black uppercase tracking-[2px] text-primary/40 hover:text-primary transition-all p-2"
                 >
                    [ Developer: Auto-Generate Partner ]
                 </button>
              </div>
            </div>
          </motion.div>
        )}

        {mode === 'manual' && (
          <motion.div key="manual" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex flex-col h-full items-center justify-center text-center space-y-8 px-4">
            <button onClick={() => handleModeChange('decision')} className="absolute top-6 left-6 w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-white/40 hover:text-white transition-colors"><ArrowLeft size={24} /></button>
            
            <div className="space-y-3">
              <h2 className="text-3xl font-black text-white tracking-tight">MANUAL PAIR</h2>
              <p className="text-white/40 text-sm font-medium">Enter your partner's Secure ID to connect</p>
            </div>

            <div className="w-full space-y-4">
              <input 
                type="text" 
                value={enteredPartnerId} 
                onChange={(e) => setEnteredPartnerId(e.target.value)}
                placeholder="Partner ID (e.g. user_abcd...)"
                className="w-full h-16 bg-white/5 border border-white/10 rounded-[24px] px-6 text-white font-mono text-center focus:outline-none focus:border-primary/50 transition-all"
              />
              <button 
                onClick={handleManualConnect}
                disabled={!enteredPartnerId || isConnecting}
                className="w-full h-16 bg-primary text-white rounded-[24px] font-black text-lg shadow-[0_10px_30px_rgba(255,107,0,0.3)] active:scale-95 transition-all flex items-center justify-center space-x-3 disabled:opacity-50 disabled:grayscale"
              >
                {isConnecting ? <Loader2 size={24} className="animate-spin" /> : <RefreshCw size={24} />}
                <span>{isConnecting ? 'Connecting...' : 'Establish Link'}</span>
              </button>
            </div>

            <div className="pt-8 opacity-40">
               <p className="text-[11px] font-bold uppercase tracking-[2px]">Ensuring End-to-End Encryption</p>
            </div>
          </motion.div>
        )}

        {mode === 'show' && (
          <motion.div key="show" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex flex-col h-full items-center justify-center space-y-10">
            <button onClick={() => handleModeChange('decision')} className="absolute top-6 left-6 w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-white/40 hover:text-white transition-colors"><ArrowLeft size={24} /></button>
            
            <div className="text-center space-y-3">
              <h2 className="text-3xl font-black text-white tracking-tight">MY SECURE QR</h2>
              <p className="text-white/40 text-sm font-medium">Let your partner scan this to pair</p>
            </div>

            <div className="p-8 bg-white rounded-[40px] shadow-[0_0_60px_rgba(255,107,0,0.2)]">
              <QRCodeSVG value={JSON.stringify({ userId: myId, publicKey: publicKey })} size={240} level="H" includeMargin={false} />
            </div>

            <div className="flex items-center space-x-3 px-6 py-3 bg-primary/10 rounded-full border border-primary/20">
              <RefreshCw size={16} className="text-primary animate-spin-slow" />
              <span className="text-primary/80 text-xs font-bold uppercase tracking-widest">Awaiting Scan...</span>
            </div>

            {isConnecting && (
               <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-50">
                  <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                  <p className="text-white font-bold">Establishing Secure Link...</p>
               </div>
            )}
          </motion.div>
        )}

        {mode === 'scan' && (
          <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col h-full fixed inset-0 bg-black">
             <button onClick={() => handleModeChange('decision')} className="absolute top-10 left-6 z-50 w-12 h-12 bg-black/20 backdrop-blur-xl rounded-full flex items-center justify-center text-white/40 hover:text-white"><ArrowLeft size={24} /></button>

             <div className="relative flex-1 flex items-center justify-center overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                <canvas ref={canvasRef} className="hidden" />

                <div className="absolute inset-0 border-[40px] border-black/60 pointer-events-none">
                  <div className="relative w-full h-full">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-4 border-primary/50 rounded-[48px]">
                      <div className="absolute inset-0 bg-primary/20 rounded-[44px]" />
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-20 left-0 right-0 text-center space-y-2">
                   <h3 className="text-white font-black text-xl tracking-tight uppercase">{scanStatus === 'found' ? 'LOCKING TARGET...' : 'ALIGN QR CODE'}</h3>
                   <p className="text-white/40 text-[13px] font-medium uppercase tracking-[2px]">Encrypted Lens Active</p>
                </div>
             </div>

             {error && (
               <div className="absolute top-24 left-6 right-6 p-4 bg-red-500/20 border border-red-500/30 rounded-2xl flex items-center space-x-3 text-red-400">
                 <AlertCircle size={20} />
                 <p className="text-xs font-bold">{error}</p>
               </div>
             )}

             {isConnecting && (
               <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-50">
                  <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                  <p className="text-white font-bold">Verifying Partner Identity...</p>
                  <button 
                    onClick={() => setIsConnecting(false)}
                    className="mt-8 text-white/40 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
                  >
                    Cancel Pairing
                  </button>
               </div>
             )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
