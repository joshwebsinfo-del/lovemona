const fs = require('fs');
const path = 'c:\\Users\\JOSHWEBS\\Desktop\\MONA\\client\\src\\pages\\DashboardScreen.tsx';
let content = fs.readFileSync(path, 'utf8');

const startMarker = '{/* STICKY NOTES BOARD */}';
const endMarker = '<div className="grid grid-cols-2 gap-4">';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    const newWidget = `         {/* STICKY NOTES BOARD */}
         <div className="grid grid-cols-2 gap-3 w-full relative z-20 mb-2">
            {/* My Note */}
            <div 
              className="bg-yellow-200/90 text-zinc-900 p-4 rounded-sm shadow-lg transform -rotate-1 hover:rotate-0 transition-transform cursor-pointer relative min-h-[140px] flex flex-col justify-between"
              onClick={() => { setIsEditingNote(true); setNoteInput(myNote); }}
            >
               <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-zinc-400/20 rounded-full blur-sm" />
               <div className="absolute top-2 right-2 opacity-20"><Edit3 size={14} /></div>
               <p className="font-handwriting text-[15px] leading-snug break-words">{myNote}</p>
               <p className="text-[9px] mt-2 opacity-40 font-black uppercase tracking-widest text-right">— Me</p>
            </div>

            {/* Partner Note */}
            <div 
              className="bg-sky-200/90 text-zinc-900 p-4 rounded-sm shadow-lg transform rotate-2 hover:rotate-0 transition-transform relative min-h-[140px] flex flex-col justify-between"
            >
               <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-zinc-400/20 rounded-full blur-sm" />
               <p className="font-handwriting text-[15px] leading-snug break-words">{partnerNote}</p>
               <p className="text-[9px] mt-2 opacity-40 font-black uppercase tracking-widest text-right truncate">— {partner?.nick || 'Partner'}</p>
            </div>
         </div>

         {isEditingNote && (
            <div className="flex flex-col space-y-2 relative z-50 mb-4 bg-zinc-900 p-4 rounded-2xl border border-white/10">
               <textarea 
                  value={noteInput} onChange={e => setNoteInput(e.target.value)}
                  className="bg-black/50 text-white rounded-xl p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-20 resize-none font-medium italic"
                  autoFocus
                  placeholder="Tell your partner something..."
               />
               <div className="flex justify-end space-x-2">
                  <button onClick={() => setIsEditingNote(false)} className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold active:scale-95 text-white/60">Cancel</button>
                  <button onClick={saveStickyNote} className="px-3 py-1 bg-primary rounded-lg text-xs font-bold text-white active:scale-95 shadow-lg shadow-primary/30">Save Note</button>
               </div>
            </div>
         )}
\n`;
    content = content.substring(0, startIndex) + newWidget + content.substring(endIndex);
    fs.writeFileSync(path, content);
    console.log("Widget updated");
} else {
    console.log("Could not find markers", {startIndex, endIndex});
}
