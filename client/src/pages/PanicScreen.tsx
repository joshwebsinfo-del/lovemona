
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import { initDB } from '../lib/db';

export const PanicScreen: React.FC = () => {
  const [confirming, setConfirming] = useState(false);
  const [nuking, setNuking] = useState(false);

  const performNuke = async () => {
    setNuking(true);
    try {
      const db = await initDB();
      // Wipe the database to a blank state
      await db.clear('messages');
      await db.clear('vault');
      await db.clear('identity');
      await db.clear('partner');
      await db.clear('auth');
      
      // Wipe local storage just in case
      localStorage.clear();
      
      // Attempt to close connection (socket will drop on reload anyway)
      
      setTimeout(() => {
        // Redirect to a completely benign website
        window.location.replace('https://www.google.com/search?q=weather+today');
      }, 1000);

    } catch (e) {
      console.error(e);
      // Even if it fails, try to redirect
      window.location.replace('https://www.google.com/search?q=weather+today');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] no-scrollbar overflow-y-auto px-6">
      
      <div className="pt-24 text-center">
        <div className="w-24 h-24 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <ShieldAlert size={48} className="text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">Panic Mode</h1>
        <p className="text-sm text-white/50 leading-relaxed mb-6">
          If you are in danger or being forced to show your phone, you can instantly nuke all local data.
        </p>
      </div>

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
                  className="w-full h-16 bg-red-500 text-white rounded-2xl font-bold text-lg shadow-2xl shadow-red-500/30 flex items-center justify-center animate-pulse"
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
