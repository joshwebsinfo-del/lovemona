import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://klnwoqhuztmmsezosxby.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsbndvcWh1enRtbXNlem9zeGJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTA3MDcsImV4cCI6MjA5MTQyNjcwN30.jkGDFdtxeG8Sp3jxB0y_GoHU-1Op0TAnAPn7vY6dSP4';

export const supabase = createClient(supabaseUrl, supabaseKey);
