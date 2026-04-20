import React, { useEffect, useState } from 'react';
import { initDB } from '../lib/db';
import { getSocket } from '../lib/socket';
import { supabase } from '../lib/supabase';

interface Theme {
  id: string;
  type: 'gradient' | 'image';
  color?: string;
  image?: string;
}

export const GlobalBackground: React.FC = () => {
  const [theme, setTheme] = useState<Theme>({ id: 'default', type: 'gradient', color: 'from-zinc-800 via-zinc-950 to-black' });
  const [personalization, setPersonalization] = useState('Mona & Josh');

  
  useEffect(() => {
    const load = async () => {
       const db = await initDB();
       const settings = await db.get('settings', 'main');
       const p = await db.get('partner', 'partner');
       const iden = await db.get('identity', 'me');
       const auth = await db.get('auth', 'pins');
       
       if (auth && p) {
          setPersonalization(`${auth.nickname} & ${p.nick}`);
       } else if (auth) {
          setPersonalization(`${auth.nickname} & ...`);
       }

       if (settings) {
          if (settings.theme) applyThemeById(settings.theme, settings.imageUrl);
       }


       // Listen for mood/theme signals
       const s = getSocket();
       if (s) {
          s.on('message:receive', async () => {
             // We need the shared key here, but for simplicity we rely on the DB sync for background mostly
             // However, real-time mood change is nice
          });
       }

       // Supabase Realtime for theme sync
       if (iden && p) {
         const channel = supabase.channel('theme_sync')
           .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hub_sync', filter: `partner_id=eq.${iden.userId}` }, async () => {
               // Re-fetch to get latest
           })
           .subscribe();
         return () => { supabase.removeChannel(channel); };
       }
    };
    load();

    // Listen for custom events from Dashboard/Settings
    const handleThemeChange = (e: any) => {
       const { mood, imageUrl } = e.detail;
       applyThemeById(mood, imageUrl);
    };
     window.addEventListener('theme-updated', handleThemeChange as any);
     return () => {
        window.removeEventListener('theme-updated', handleThemeChange as any);

     };
  }, []);

  const applyThemeById = (id: string, customUrl?: string) => {
     if (customUrl) {
        setTheme({ id: 'custom', type: 'image', image: customUrl });
        return;
     }

     const presets: Record<string, Theme> = {
        'passionate': { id: 'passionate', type: 'gradient', color: 'from-rose-500/30 via-zinc-950 to-black' },
        'calm': { id: 'calm', type: 'gradient', color: 'from-sky-500/20 via-zinc-950 to-black' },
        'playful': { id: 'playful', type: 'gradient', color: 'from-fuchsia-500/20 via-zinc-950 to-black' },
        'midnight': { id: 'midnight', type: 'image', image: '/themes/midnight.png' },
        'rose': { id: 'rose', type: 'image', image: '/themes/rose.png' },
        'golden': { id: 'golden', type: 'image', image: '/themes/golden.png' },
        'velvet': { id: 'velvet', type: 'image', image: '/themes/velvet.png' },
        'silk': { id: 'silk', type: 'image', image: '/themes/silk.png' },
     };

     setTheme(presets[id] || { id: 'default', type: 'gradient', color: 'from-zinc-800 via-zinc-950 to-black' });
  };

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#050505]">
        <div
          key={theme.id + (theme.image || '')}
          className="absolute inset-0 transition-opacity duration-500"
        >
          {theme.type === 'gradient' ? (
             <div className={`absolute inset-0 bg-gradient-to-b ${theme.color}`} />
          ) : (
             <>
                <img 
                   src={theme.image} 
                   className="absolute inset-0 w-full h-full object-cover opacity-60" 
                   loading="lazy"
                />
               <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black" />
             </>
          )}

          {/* DYNAMIC PERSONALIZATION */}
          <div className="absolute inset-x-0 bottom-[15%] flex flex-col items-center justify-center opacity-30 select-none">
             <span className="text-4xl sm:text-5xl font-['Great_Vibes'] text-white tracking-widest text-center px-10 drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                {personalization}
             </span>
             <div className="h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent mt-4 w-[60px]" />
          </div>
        </div>
    </div>
  );
};
