
import React, { useState, useEffect } from 'react';
import { ArrowLeft, User, Shield, Palette, Image as ImageIcon, Trash2, Heart, Check, Lock, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { importPublicKey, deriveSharedSecret, encryptMessage } from '../lib/crypto';
import { getSocket } from '../lib/socket';
import { useNotifications } from '../components/NotificationProvider';

export const SettingsScreen: React.FC = () => {
  const { showNotification, subscribeToPush, sendTestPush, isPushSupported } = useNotifications();
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [theme, setTheme] = useState('passionate');
  const [wallpaper, setWallpaper] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [myId, setMyId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [syncTheme, setSyncTheme] = useState(true); // Unified Theme Experience

  const themes = [
    { id: 'passionate', label: 'Passionate', color: 'bg-rose-500', type: 'gradient' },
    { id: 'calm', label: 'Calm', color: 'bg-sky-500', type: 'gradient' },
    { id: 'playful', label: 'Playful', color: 'bg-fuchsia-500', type: 'gradient' },
    { id: 'silk', label: 'Silk & Moonlight', image: '/themes/silk.png', type: 'image' },
    { id: 'midnight', label: 'Midnight Sparkle', image: '/themes/midnight.png', type: 'image' },
    { id: 'rose', label: 'Rose Garden', image: '/themes/rose.png', type: 'image' },
    { id: 'golden', label: 'Golden Hour', image: '/themes/golden.png', type: 'image' },
    { id: 'velvet', label: 'Abstract Velvet', image: '/themes/velvet.png', type: 'image' },
  ];

  const wallpapers = [
    { id: 'none', label: 'Default Dark', color: 'bg-zinc-900', type: '' },
    { id: 'rose', label: 'Live Rose', color: 'bg-rose-900', type: 'rose' },
    { id: 'ocean', label: 'Live Ocean', color: 'bg-blue-900', type: 'ocean' },
    { id: 'nebula', label: 'Live Nebula', color: 'bg-purple-900', type: 'nebula' },
    { id: 'silk_w', label: 'Silk & Moonlight', preview: '/themes/silk.png', type: '/themes/silk.png' },
    { id: 'mid_w', label: 'Midnight Sparkle', preview: '/themes/midnight.png', type: '/themes/midnight.png' },
    { id: 'rose_w', label: 'Rose Garden', preview: '/themes/rose.png', type: '/themes/rose.png' },
    { id: 'gold_w', label: 'Golden Hour', preview: '/themes/golden.png', type: '/themes/golden.png' },
    { id: 'velv_w', label: 'Abstract Velvet', preview: '/themes/velvet.png', type: '/themes/velvet.png' },
    { id: 'w1', label: 'Soft Flowers', preview: '/romantic_wallpaper_1_1775916866188.png', type: '/romantic_wallpaper_1_1775916866188.png' },
    { id: 'w2', label: 'Rose Silk', preview: '/romantic_wallpaper_2_1775917125503.png', type: '/romantic_wallpaper_2_1775917125503.png' },
  ];

  useEffect(() => {
    const loadSettings = async () => {
      const db = await initDB();
      const auth = await db.get('auth', 'pins');
      if (auth) {
        setNickname(auth.nickname);
        if (auth.avatar) setAvatar(auth.avatar);
      }

      const settings = await db.get('settings', 'main');
      if (settings) {
        setTheme(settings.theme || 'passionate');
        setWallpaper(settings.wallpaper || '');
        if (settings.syncTheme !== undefined) setSyncTheme(settings.syncTheme);
      }

      const identity = await db.get('identity', 'me');
      if (identity) setMyId(identity.userId);
      const partner = await db.get('partner', 'partner');
      if (partner) setPartnerId(partner.userId);
    };
    loadSettings();
  }, []);

  const handleThemeImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
       const img = new Image();
       img.src = reader.result as string;
       img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 1200; // Better quality for backgrounds
          let { width, height } = img;
          if (width > height) {
             if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
          } else {
             if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          setTheme('custom');
          saveSettings({ theme: 'custom', imageUrl: dataUrl });
          window.dispatchEvent(new CustomEvent('theme-updated', { detail: { mood: 'custom', imageUrl: dataUrl } }));
       };
    };
    reader.readAsDataURL(file);
  };

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
        const newAvatar = canvas.toDataURL('image/jpeg', 0.8);
        setAvatar(newAvatar);
        saveSettings({ avatar: newAvatar });
      };
    };
    reader.readAsDataURL(file);
  };

  const saveSettings = async (updates: any) => {
    const db = await initDB();
    const current = await db.get('settings', 'main') || { id: 'main' };
    const next = { ...current, ...updates };
    await db.put('settings', next);
    
    // Also update identity if nickname/wallpaper changed
    const idRes = await db.get('identity', 'me');
    if (idRes) {
       const supabaseUpdate: any = {};
        if (updates.nickname) supabaseUpdate.nickname = updates.nickname;
        if (updates.avatar) supabaseUpdate.avatar = updates.avatar;
        if (updates.wallpaper !== undefined) supabaseUpdate.wallpaper = updates.wallpaper;
        if (updates.theme) supabaseUpdate.theme = updates.theme;
        if (updates.imageUrl !== undefined) supabaseUpdate.imageUrl = updates.imageUrl;
       
       if (Object.keys(supabaseUpdate).length > 0) {
          try {
             await supabase.from('users').update(supabaseUpdate).eq('user_id', idRes.userId);
          } catch (e) {
             console.warn('Supabase sync failed (might be missing column):', e);
          }
       }
    }
    if (updates.nickname || updates.avatar) {
       const [auth, partner] = await Promise.all([
         db.get('auth', 'pins'),
         db.get('partner', 'partner')
       ]);
       
       if (auth) {
          if (updates.nickname) auth.nickname = updates.nickname;
          if (updates.avatar) auth.avatar = updates.avatar;
          await db.put('auth', auth);
       }
       
       // Broadcast sync to partner
       if (idRes && partner) {
         try {
           const importedPartnerKey = await importPublicKey(partner.publicKeyPem);
           const sharedKey = await deriveSharedSecret(idRes.privateKey, importedPartnerKey);
           
           const payload = {
             type: 'identity:sync',
             nick: updates.nickname || auth?.nickname,
             avatar: updates.avatar || auth?.avatar
           };
           
           const enc = await encryptMessage(sharedKey, JSON.stringify(payload));
           const s = getSocket();
           if (s && s.connected) {
             s.emit('message:send', {
               to: partner.userId,
               encrypted: enc.encrypted,
               iv: enc.iv,
               senderId: idRes.userId,
               messageId: `sync-${Date.now()}`
             });
           }
         } catch(e) { console.error('Failed to sync identity updates', e); }
       }
    }
    
    if (updates.theme || updates.imageUrl) {
        window.dispatchEvent(new CustomEvent('theme-updated', { detail: { mood: updates.theme || theme, imageUrl: updates.imageUrl } }));
        const pSync = await db.get('partner', 'partner');
        const idenSync = await db.get('identity', 'me');
         if (pSync && idenSync) {
            try {
               const importedPartnerKey = await importPublicKey(pSync.publicKeyPem);
               const sharedKey = await deriveSharedSecret(idenSync.privateKey, importedPartnerKey);
               const moodPayload = { type: 'signal:mood', mood: updates.theme || theme, imageUrl: updates.imageUrl };
               const enc = await encryptMessage(sharedKey, JSON.stringify(moodPayload));
               const s = getSocket();
               if (s && s.connected) {
                  s.emit('message:send', { to: pSync.userId, encrypted: enc.encrypted, iv: enc.iv, senderId: idenSync.userId });
               }

               // Mirror Global Theme to Chat Wallpaper if Sync is enabled
               if (syncTheme && (updates.theme || updates.imageUrl)) {
                  const themeObj = themes.find(t => t.id === (updates.theme || theme));
                  if (themeObj && themeObj.type === 'image') {
                     setWallpaper(themeObj.image || '');
                     await db.put('settings', { ...(await db.get('settings', 'main')), wallpaper: themeObj.image || '' });
                     await supabase.from('users').update({ wallpaper: themeObj.image || '' }).eq('user_id', idRes.userId);
                  }
               }

               await supabase.from('hub_sync').insert([{
                 id: `mood_${idenSync.userId}_${Date.now()}`,
                 type: 'mood',
                 owner_id: idenSync.userId,
                 partner_id: pSync.userId,
                 encrypted_payload: enc.encrypted,
                 iv: enc.iv,
                 updated_at: Date.now()
              }]);
           } catch(e) {}
        }
    }
  };

  const clearChatHistory = async () => {
    if (!confirm('This will permanently delete ALL messages from both your device AND the cloud. Are you sure?')) return;
    
    setIsClearing(true);
    try {
       const db = await initDB();
       const identity = await db.get('identity', 'me');
       const partner = await db.get('partner', 'partner');

       if (identity && partner) {
          // 1. Delete from Cloud
          await supabase.from('messages')
            .delete()
            .or(`and(sender_id.eq.${identity.userId},recipient_id.eq.${partner.userId}),and(sender_id.eq.${partner.userId},recipient_id.eq.${identity.userId})`);
          
          // 2. Clear locally
          await db.clear('messages');
          showNotification({ title: 'Privacy Ops', message: 'Chat history cleared permanently across all devices.', type: 'success' });
       }
    } catch {
       showNotification({ title: 'Error', message: 'Failed to clear some cloud data.', type: 'alert' });
    } finally {
       setIsClearing(false);
    }
  };

  const lockAppManually = () => {
    localStorage.removeItem('lock_session');
    window.location.href = '/'; // Hard reload to clear App state and show LockScreen
  };

  return (
    <div className="flex flex-col h-full bg-[#050505] p-6 no-scrollbar overflow-y-auto w-full">
      <div className="pt-14 pb-8 flex items-center">
        <button onClick={() => navigate('/')} className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-white/40 mr-4">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Our Line Settings</h2>
      </div>

      <div className="space-y-8 pb-32">
        {/* PROFILE SECTION */}
        <div className="space-y-4">
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <User size={12} />
             <span>Partner Identity</span>
          </label>
          <div className="bg-zinc-900/50 rounded-[32px] p-6 border border-white/5">
             <div className="space-y-1 mb-4">
                <p className="text-white/40 text-[11px] font-bold uppercase tracking-wider ml-1">My Nickname</p>
                <input 
                  type="text" 
                  value={nickname}
                  onChange={(e) => {
                     setNickname(e.target.value);
                     saveSettings({ nickname: e.target.value });
                  }}
                  className="w-full h-14 bg-black border border-white/10 rounded-[20px] px-6 text-white font-bold focus:border-primary outline-none transition-all"
                  placeholder="The one they see..."
                />
             </div>
             
             <div className="space-y-1">
                <p className="text-white/40 text-[11px] font-bold uppercase tracking-wider ml-1">My Avatar</p>
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-black border border-white/10 flex items-center justify-center shrink-0 shadow-lg relative">
                    {avatar ? (
                      <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <User size={24} className="text-white/30" />
                    )}
                  </div>
                  <label className="flex-1 h-12 bg-white/5 border border-white/10 text-white/80 rounded-xl flex items-center justify-center font-semibold text-sm active:scale-95 transition-all text-center cursor-pointer">
                     Change Photo
                     <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                </div>
             </div>
          </div>
        </div>

        {/* LOOK & FEEL */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2 px-1">
             <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px]">
                <Palette size={12} />
                <span>Romantic Theme</span>
             </label>
             <button 
                onClick={() => {
                   const newVal = !syncTheme;
                   setSyncTheme(newVal);
                   saveSettings({ syncTheme: newVal });
                }}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border transition-all ${syncTheme ? 'bg-primary/20 border-primary/50 text-white' : 'bg-white/5 border-white/10 text-white/30'}`}
             >
                <div className={`w-3 h-3 rounded-full transition-all ${syncTheme ? 'bg-primary shadow-[0_0_8px_rgba(255,107,0,0.8)]' : 'bg-white/20'}`} />
                <span className="text-[9px] font-black uppercase tracking-widest">Connect Chat Bg</span>
             </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
             {themes.map(t => (
                <button 
                  key={t.id}
                  onClick={() => {
                     setTheme(t.id);
                     saveSettings({ theme: t.id, imageUrl: null });
                  }}
                  className={`h-24 rounded-[28px] border transition-all relative overflow-hidden group ${theme === t.id ? 'border-primary' : 'bg-white/5 border-white/5 text-white/40'}`}
                >
                   {t.type === 'image' ? (
                      <img src={t.image} className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                   ) : (
                      <div className={`absolute inset-0 opacity-40 ${t.color}`} />
                   )}
                   <div className="relative z-10 w-full h-full flex items-center justify-between px-4 bg-black/20">
                      <span className="text-[11px] font-black tracking-widest uppercase text-white shadow-black drop-shadow-lg">{t.label}</span>
                      {theme === t.id && <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-white shadow-lg"><Check size={14} /></div>}
                   </div>
                </button>
             ))}
             {/* Custom Theme Upload */}
             <label className={`h-24 rounded-[28px] border flex flex-col items-center justify-center space-y-1 cursor-pointer transition-all ${theme === 'custom' ? 'bg-primary/20 border-primary text-primary' : 'bg-white/5 border-white/5 text-white/20 hover:text-white/40'}`}>
                <ImageIcon size={20} />
                <span className="text-[9px] font-black uppercase tracking-widest">Custom Theme</span>
                <input type="file" accept="image/*" onChange={handleThemeImageUpload} className="hidden" />
                {theme === 'custom' && <div className="absolute top-2 right-2"><Check size={12} /></div>}
             </label>
          </div>
        </div>

        {/* CHAT WALLPAPER */}
        <div className="space-y-4">
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <ImageIcon size={12} />
             <span>Chat Wallpaper</span>
          </label>
          <div className="flex space-x-4 overflow-x-auto no-scrollbar py-2">
             {wallpapers.map(w => (
                <button 
                  key={w.id}
                  onClick={() => {
                     setWallpaper(w.type);
                     saveSettings({ wallpaper: w.type });
                  }}
                  className={`flex-shrink-0 w-32 h-48 rounded-[32px] overflow-hidden border-2 transition-all relative ${wallpaper === w.type ? 'border-primary scale-95 shadow-lg' : 'border-white/5'}`}
                >
                   {w.preview ? (
                      <img src={w.preview} className="w-full h-full object-cover" />
                   ) : (
                      <div className={`w-full h-full ${w.color} flex items-center justify-center`}>
                         <div className="w-8 h-8 rounded-full border border-white/20 animate-pulse" />
                      </div>
                   )}
                   <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-4">
                      <span className="text-[10px] font-black text-white uppercase tracking-tighter">{w.label}</span>
                   </div>
                   {wallpaper === w.type && (
                      <div className="absolute top-3 right-3 w-7 h-7 bg-primary rounded-full flex items-center justify-center text-white shadow-lg">
                         <Check size={16} />
                      </div>
                   )}
                </button>
             ))}
          </div>
        </div>

        {/* DEVICE SECURITY & RECOVERY */}
        <div className="space-y-4">
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <Shield size={12} />
             <span>Device Security</span>
          </label>
          <div className="bg-white/5 rounded-[32px] p-6 border border-white/10 space-y-4">
             <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-primary/60 px-1">
                   <span>My Rescue ID</span>
                   <span className="opacity-50">Private</span>
                </div>
                <div 
                   onClick={() => {
                      navigator.clipboard.writeText(myId);
                      showNotification({ title: 'Rescue ID', message: 'Device ID copied. Keep this safe!', type: 'success' });
                   }}
                   className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white/60 text-[11px] font-mono break-all cursor-pointer hover:bg-black/60 transition-all border-dashed"
                >
                   {myId || 'Loading...'}
                </div>
                <p className="text-[10px] text-white/20 mt-1 px-1">Give this to your partner only if they lose their PIN.</p>
             </div>

             <div className="pt-2">
                <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-white/40 px-1">
                   <span>Partner's Rescue ID</span>
                </div>
                <div 
                  onClick={() => {
                     if(partnerId) {
                        navigator.clipboard.writeText(partnerId);
                        showNotification({ title: 'Rescue ID', message: "Partner's ID copied. Ready to help!", type: 'success' });
                     }
                  }}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white/60 text-[11px] font-mono break-all cursor-pointer hover:bg-black/60 transition-all"
                >
                   {partnerId || 'No Partner Paired'}
                </div>
                <p className="text-[10px] text-white/20 mt-1 px-1 italic">Use this to help your partner reset their PIN.</p>
             </div>
          </div>
        </div>

        {/* DATA MANAGEMENT */}
        <div className="space-y-4">
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <Trash2 size={12} />
             <span>Privacy Ops</span>
          </label>
          <div className="bg-red-500/5 border border-red-500/10 rounded-[32px] p-6 space-y-4">
             <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center text-red-500 mt-1">
                   <Trash2 size={20} />
                </div>
                <div className="flex-1">
                   <h4 className="text-white font-bold text-[15px]">Nuclear Clear</h4>
                   <p className="text-white/30 text-xs">Permanently delete all chat history on both devices and the cloud.</p>
                </div>
             </div>
             <button 
               disabled={isClearing}
               onClick={clearChatHistory}
               className="w-full h-14 bg-red-500 text-white font-black rounded-[20px] shadow-lg shadow-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center"
             >
                {isClearing ? 'Clearing Everywhere...' : 'CLEAR ALL CHATS'}
             </button>
          </div>
        </div>

        {/* LOCK SESSION */}
        <div className="space-y-4">
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <Lock size={12} />
             <span>Session Control</span>
          </label>
          <div className="bg-white/5 border border-white/10 rounded-[32px] p-6 space-y-4">
             <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white/40 mt-1">
                   <Lock size={20} />
                </div>
                <div className="flex-1">
                   <h4 className="text-white font-bold text-[15px]">Manual Lock</h4>
                   <p className="text-white/30 text-xs">End your persistent session and require a PIN on next open.</p>
                </div>
             </div>
             <button 
               onClick={lockAppManually}
               className="w-full h-14 bg-zinc-800 text-white font-black rounded-[20px] border border-white/10 active:scale-[0.98] transition-all flex items-center justify-center space-x-2"
             >
                <Lock size={18} />
                <span>LOCK APP NOW</span>
             </button>
          </div>
        </div>

        {/* NOTIFICATION CONTROL */}
        <div className="space-y-4">
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <Bell size={12} />
             <span>Notification Control</span>
          </label>
          <div className="bg-white/5 rounded-[32px] p-6 border border-white/10 space-y-4">
             <div className="flex items-start space-x-4">
                <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center text-primary mt-1">
                   <Bell size={20} />
                  </div>
                <div className="flex-1">
                   <h4 className="text-white font-bold text-[15px]">Push Notifications</h4>
                   <p className="text-white/30 text-xs">Stay synchronized in your private world with background alerts.</p>
                </div>
             </div>
             
             {!isPushSupported ? (
               <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-[10px] font-black uppercase tracking-widest text-red-500 text-center">
                  Push Not Supported on this Browser
               </div>
             ) : (
               <div className="grid grid-cols-2 gap-3">
                 <button 
                   onClick={() => {
                     if (myId) subscribeToPush(myId);
                     else showNotification({ title: 'System', message: 'Identity not loaded.', type: 'alert' });
                   }}
                   className="h-14 bg-white/5 text-white/80 font-black rounded-[20px] border border-white/10 active:scale-[0.98] transition-all flex items-center justify-center text-xs uppercase tracking-widest"
                 >
                   Set Permission
                 </button>
                 <button 
                   onClick={() => {
                     if (myId) sendTestPush(myId);
                     else showNotification({ title: 'System', message: 'Identity not loaded.', type: 'alert' });
                   }}
                   className="h-14 bg-primary text-white font-black rounded-[20px] shadow-lg shadow-primary/20 active:scale-[0.98] transition-all flex items-center justify-center text-xs uppercase tracking-widest"
                 >
                   Send Test Push
                 </button>
               </div>
             )}
          </div>
        </div>

      </div>

      <div className="flex flex-col items-center py-8">
         <Heart size={16} fill="#ff6b00" className="text-primary mb-2 animate-pulse" />
         <p className="text-[10px] font-black text-white/20 uppercase tracking-[4px]">SecureLove Intimacy Protocol</p>
      </div>

    </div>
  );
};
