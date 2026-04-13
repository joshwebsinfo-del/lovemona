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
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within a NotificationProvider');
  return context;
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
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

  const showNotification = useCallback((params: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast = { ...params, id };
    
    setToasts(prev => [...prev, newToast]);
    
    // Play sound if system allows
    notificationSound.current?.play().catch(() => {});

    // Browser Notification (Phase 2)
    if (Notification.permission === 'granted') {
      try {
        new Notification(params.title, {
          body: params.message,
          icon: params.avatar || '/pwa-192x192.png',
          tag: params.type,
          silent: true // App handles sound
        });
      } catch (e) {
        console.warn('Local notification failed', e);
      }
    }

    // Auto-remove toast after 5 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification, requestPermission }}>
      {children}
      
      {/* Toast Container */}
      <div className="fixed top-0 left-0 right-0 z-[200] pointer-events-none flex flex-col items-center p-4 space-y-3">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              onClick={() => {
                toast.action?.();
                setToasts(prev => prev.filter(t => t.id !== toast.id));
              }}
              className="pointer-events-auto w-full max-w-sm bg-[#1a1a1e]/90 backdrop-blur-2xl border border-white/10 rounded-2xl p-4 shadow-2xl flex items-center space-x-4 cursor-pointer active:scale-95 transition-transform"
            >
              <div className="relative flex-shrink-0">
                {toast.avatar ? (
                  <img src={toast.avatar} alt="" className="w-12 h-12 rounded-full border border-white/10 shadow-lg" />
                ) : (
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center border border-white/10 shadow-lg ${
                    toast.type === 'message' ? 'bg-primary/20 text-primary' : 
                    toast.type === 'alert' ? 'bg-red-500/20 text-red-500' :
                    'bg-zinc-800 text-white/40'
                  }`}>
                    {toast.type === 'message' && <MessageCircle size={24} />}
                    {toast.type === 'system' && <ShieldCheck size={24} />}
                    {toast.type === 'alert' && <Bell size={24} />}
                    {toast.type === 'success' && <Info size={24} />}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full border-2 border-[#1a1a1e] animate-pulse" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-white font-black text-xs uppercase tracking-widest truncate">{toast.title}</h4>
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest ml-2">Now</span>
                </div>
                <p className="text-white/60 text-sm truncate mt-0.5 font-medium">{toast.message}</p>
              </div>

              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts(prev => prev.filter(t => t.id !== toast.id));
                }}
                className="p-1.5 hover:bg-white/5 rounded-full text-white/30 transition-colors"
              >
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
};
