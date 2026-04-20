import React from 'react';
import { Shield, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react';

interface ConnectionHealthProps {
  isSocketConnected: boolean;
  isPartnerOnline: boolean;
  isEncryptionReady: boolean;
}

export const ConnectionHealth: React.FC<ConnectionHealthProps> = ({ 
  isSocketConnected, 
  isPartnerOnline, 
  isEncryptionReady 
}) => {
  const getStatus = () => {
    if (!isSocketConnected) return { label: 'Offline', color: 'text-red-400', icon: WifiOff };
    if (!isEncryptionReady) return { label: 'Sync Error', color: 'text-amber-400', icon: ShieldAlert };
    if (!isPartnerOnline) return { label: 'Connected', color: 'text-primary', icon: Shield };
    return { label: 'Private Node Active', color: 'text-green-400', icon: ShieldCheck };
  };

  const { label, color, icon: Icon } = getStatus();

  return (
    <div className={`flex items-center space-x-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 ${color} transition-colors duration-500`}>
      <Icon size={14} />
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      
      {!isPartnerOnline && isSocketConnected && (
         <div className="flex space-x-0.5 ml-1">
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <div className="w-1 h-1 rounded-full bg-white/20" />
         </div>
      )}
    </div>
  );
};
