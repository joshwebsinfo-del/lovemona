import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageCircle, Bell, ShieldCheck, Info } from 'lucide-react';

type NotificationType = 'message' | 'system' | 'alert' | 'success';

interface Toast {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  avatar?: string;
  action?: () => void;
}

interface NotificationContextType {
  showNotification: (params: Omit<Toast, 'id'>) => void;
  requestPermission: () => Promise<boolean>;
  subscribeToPush: (userId: string) => Promise<boolean>;
  sendTestPush: (userId: string) => Promise<void>;
  isPushSupported: boolean;
}

const VAPID_PUBLIC_KEY = 'BGFQdFBv_xpe6nSmdZ7eEGtCIW8hJT_JudRtHfXca8QQPMgOn58gQbsc5-FNe4ibOmPk4H8PMgfbMuGduEN3eaI';

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within a NotificationProvider');
  return context;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPushSupported] = useState(() => 'serviceWorker' in navigator && 'PushManager' in window);
  const notificationSound = React.useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    notificationSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
    notificationSound.current.volume = 0.5;
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }, []);

  const subscribeToPush = useCallback(async (userId: string) => {
    if (!isPushSupported) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      
      // Request permission first
      const hasPermission = await requestPermission();
      if (!hasPermission) return false;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      // Send to server
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subscription })
      });

      if (!response.ok) throw new Error('Failed to save subscription');
      
      console.log('[push] Subscribed successfully');
      return true;
    } catch (error) {
      console.error('[push] Subscription failed:', error);
      return false;
    }
  }, [isPushSupported, requestPermission]);

  const sendTestPush = useCallback(async (userId: string) => {
    try {
      const response = await fetch(`/api/push/test/${userId}`);
      if (!response.ok) throw new Error('Test push failed');
      showNotification({
        title: 'System',
        message: 'Test notification triggered!',
        type: 'success'
      });
    } catch (error) {
      console.error('[push] Test failed:', error);
    }
  }, []);

  const showNotification = useCallback((params: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast = { ...params, id };
    
    setToasts(prev => [...prev, newToast]);
    
    // Play sound if system allows
    notificationSound.current?.play().catch(() => {});

    // Browser Notification (System-Level)
    if (Notification.permission === 'granted') {
      const showSystemNotification = async (reg?: ServiceWorkerRegistration) => {
        const options = {
          body: params.message,
          icon: params.avatar || '/pwa-192x192.png',
          badge: '/securelove-icon.png',
          tag: params.type,
          vibrate: [200, 100, 200, 100, 400],
          requireInteraction: params.type === 'alert',
          silent: false,
          data: { url: window.location.href },
          actions: [
            { action: 'open', title: 'View Memory' }
          ]
        };

        if (reg) {
          reg.showNotification(params.title, options);
        } else {
          new Notification(params.title, options);
        }
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(showSystemNotification).catch(() => showSystemNotification());
      } else {
        showSystemNotification();
      }
    }

    // Auto-remove toast after 5 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification, requestPermission, subscribeToPush, sendTestPush, isPushSupported }}>
      {children}
      
      {/* Toast Container */}
      <div className="fixed top-4 left-4 right-4 z-[200] pointer-events-none flex flex-col items-center space-y-4">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              onClick={() => {
                toast.action?.();
                setToasts(prev => prev.filter(t => t.id !== toast.id));
              }}
              className="pointer-events-auto w-full max-w-md bg-[#0a0a0c]/80 backdrop-blur-2xl border border-white/10 rounded-[32px] p-5 shadow-2xl flex items-center space-x-4 cursor-pointer active:scale-98 transition-all ring-1 ring-white/5"
            >
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                {toast.avatar ? (
                  <img src={toast.avatar} alt="" className="w-14 h-14 rounded-full border-2 border-white/10 shadow-2xl relative z-10" />
                ) : (
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 border-white/10 shadow-2xl relative z-10 ${
                    toast.type === 'message' ? 'bg-gradient-to-br from-primary to-rose-500 text-white' : 
                    toast.type === 'alert' ? 'bg-gradient-to-br from-red-500 to-orange-500 text-white' :
                    'bg-zinc-800 text-white/60'
                  }`}>
                    {toast.type === 'message' && <MessageCircle size={24} />}
                    {toast.type === 'system' && <ShieldCheck size={24} />}
                    {toast.type === 'alert' && <Bell size={24} />}
                    {toast.type === 'success' && <Info size={24} />}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-primary rounded-full border-4 border-[#0a0a0c] z-20" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-white font-black text-xs uppercase tracking-[3px] truncate">{toast.title}</h4>
                  <span className="text-[10px] text-white/20 font-black uppercase tracking-widest ml-2">Secure Line</span>
                </div>
                <p className="text-white/70 text-[15px] truncate mt-1 font-medium leading-tight">{toast.message}</p>
              </div>

              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts(prev => prev.filter(t => t.id !== toast.id));
                }}
                className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-white/20 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
};
