
import React, { useState, useEffect } from 'react';
import { ArrowLeft, User, Shield, Palette, Image as ImageIcon, Trash2, Heart, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initDB } from '../lib/db';
import { supabase } from '../lib/supabase';
import { importPublicKey, deriveSharedSecret, encryptMessage } from '../lib/crypto';
import { getSocket } from '../lib/socket';

export const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [theme, setTheme] = useState('passionate');
  const [wallpaper, setWallpaper] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [myId, setMyId] = useState('');
  const [partnerId, setPartnerId] = useState('');

  const themes = [
    { id: 'passionate', label: 'Passionate', color: 'bg-rose-500' },
    { id: 'calm', label: 'Calm', color: 'bg-sky-500' },
    { id: 'playful', label: 'Playful', color: 'bg-fuchsia-500' },
    { id: 'classic', label: 'Classic', color: 'bg-zinc-500' },
  ];

  const wallpapers = [
    { id: 'none', label: 'Default Dark', color: 'bg-zinc-900', type: '' },
    { id: 'rose', label: 'Live Rose', color: 'bg-rose-900', type: 'rose' },
    { id: 'ocean', label: 'Live Ocean', color: 'bg-blue-900', type: 'ocean' },
    { id: 'nebula', label: 'Live Nebula', color: 'bg-purple-900', type: 'nebula' },
    { id: 'v1', label: 'Rainy Night', color: 'bg-zinc-800', type: 'video:https://player.vimeo.com/external/370331493.sd.mp4?s=7b24857490333be29396e949988acc4e578c775a&profile_id=139&oauth2_token_id=57447761' },
    { id: 'v2', label: 'Romantic Glow', color: 'bg-amber-900', type: 'video:https://player.vimeo.com/external/451838141.sd.mp4?s=d00465c4083c27e9972828b122e03239a5892b1a&profile_id=139&oauth2_token_id=57447761' },
    { id: 'v3', label: 'Star Dust', color: 'bg-slate-300', type: 'video:https://player.vimeo.com/external/455551980.sd.mp4?s=855734898144e12e171Acd4b9e288D48530C8C8a&profile_id=139&oauth2_token_id=57447761' },
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
      }

      const identity = await db.get('identity', 'me');
      if (identity) setMyId(identity.userId);
      const partner = await db.get('partner', 'partner');
      if (partner) setPartnerId(partner.userId);
    };
    loadSettings();
  }, []);

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
          alert('Chat history cleared permanently.');
       }
    } catch {
       alert('Failed to clear some data.');
    } finally {
       setIsClearing(false);
    }
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
          <label className="flex items-center space-x-2 text-[10px] font-black text-white/20 uppercase tracking-[4px] ml-1">
             <Palette size={12} />
             <span>Romantic Theme</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
             {themes.map(t => (
                <button 
                  key={t.id}
                  onClick={() => {
                     setTheme(t.id);
                     saveSettings({ theme: t.id });
                  }}
                  className={`h-16 rounded-[24px] border flex items-center justify-between px-4 transition-all ${theme === t.id ? 'bg-white text-black border-white' : 'bg-white/5 border-white/5 text-white/40'}`}
                >
                   <div className="flex items-center space-x-3">
                      <div className={`w-6 h-6 rounded-full ${t.color}`} />
                      <span className="text-[13px] font-black tracking-tight">{t.label}</span>
                   </div>
                   {theme === t.id && <Check size={16} />}
                </button>
             ))}
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
                      alert('Device ID copied to clipboard');
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
                        alert('Partner ID copied');
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

      </div>

      <div className="flex flex-col items-center py-8">
         <Heart size={16} fill="#ff6b00" className="text-primary mb-2 animate-pulse" />
         <p className="text-[10px] font-black text-white/20 uppercase tracking-[4px]">SecureLove Intimacy Protocol</p>
      </div>

    </div>
  );
};
