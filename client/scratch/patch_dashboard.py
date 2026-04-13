import sys

path = r'c:\Users\JOSHWEBS\Desktop\MONA\client\src\pages\DashboardScreen.tsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 1. Update handleReceive block (lines 142-154 approx)
# We look for the hub:game_invite block
start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if 'payload.type === \'hub:game_invite\'' in line:
        start_idx = i
    if start_idx != -1 and 'payload.type === \'hub:note\'' in line:
        # Check if we need to replace the note block too
        # Find the next } else if after that or the end of note block
        pass
    if start_idx != -1 and 'payload.type === \'text\'' in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_signal_block = [
        "                 } else if (payload.type === 'hub:game_invite') {\n",
        "                    window.dispatchEvent(new CustomEvent('incoming-game-invite', {\n",
        "                       detail: { type: 'game', isGameMode: true, gameType: payload.game || 'categories' }\n",
        "                    }));\n",
        "                 } else if (payload.type === 'hub:note') {\n",
        "                    setPartnerNote(payload.text);\n",
        "                    const db2 = await initDB();\n",
        "                    await db2.put('settings', { id: 'sticky_note_partner', data: payload.text });\n"
    ]
    lines[start_idx:end_idx] = new_signal_block

# 2. Update Sticky Note Widget (lines 447-455 approx)
start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if '{/* STICKY NOTE WIDGET */}' in line:
        start_idx = i
    if start_idx != -1 and '<p className="text-[10px] font-black uppercase tracking-[2px] text-white/30 mb-2 flex items-center">' in line:
        # end of header
        pass
    if start_idx != -1 and '</div>' in line and i > start_idx + 5: # rough end of the container
        # We need a better way to find the end of the widget
        # The widget currently has several nested divs. 
        # Let's just find the next widget start or something.
        if '{/* QUICK ACTION BUTTONS */}' in line or '/* MEMORY VAULT WIDGET */' in line:
            end_idx = i
            break

if start_idx != -1 and end_idx != -1:
    new_widget_block = [
        "         {/* STICKY NOTES BOARD */}\n",
        "         <div className=\"grid grid-cols-2 gap-3 w-full relative z-20 mb-2\">\n",
        "            {/* My Note */}\n",
        "            <div \n",
        "              className=\"bg-yellow-200/90 text-zinc-900 p-4 rounded-sm shadow-lg transform -rotate-1 hover:rotate-0 transition-transform cursor-pointer relative min-h-[140px] flex flex-col justify-between\"\n",
        "              onClick={() => { setIsEditingNote(true); setNoteInput(myNote); }}\n",
        "            >\n",
        "               <div className=\"absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-zinc-400/20 rounded-full blur-sm\" />\n",
        "               <div className=\"absolute top-2 right-2 opacity-20\"><Edit3 size={14} /></div>\n",
        "               <p className=\"font-handwriting text-[15px] leading-snug break-words\">{myNote}</p>\n",
        "               <p className=\"text-[9px] mt-2 opacity-40 font-black uppercase tracking-widest text-right\">— Me</p>\n",
        "            </div>\n",
        "\n",
        "            {/* Partner Note */}\n",
        "            <div \n",
        "              className=\"bg-sky-200/90 text-zinc-900 p-4 rounded-sm shadow-lg transform rotate-2 hover:rotate-0 transition-transform relative min-h-[140px] flex flex-col justify-between\"\n",
        "            >\n",
        "               <div className=\"absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-zinc-400/20 rounded-full blur-sm\" />\n",
        "               <p className=\"font-handwriting text-[15px] leading-snug break-words\">{partnerNote}</p>\n",
        "               <p className=\"text-[9px] mt-2 opacity-40 font-black uppercase tracking-widest text-right truncate\">— {partner?.nick || 'Partner'}</p>\n",
        "            </div>\n",
        "         </div>\n"
    ]
    lines[start_idx:end_idx] = new_widget_block

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print("Updated successfully")
