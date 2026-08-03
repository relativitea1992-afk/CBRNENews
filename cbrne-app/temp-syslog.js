const SUPABASE_URL = 'https://ldxibmeirbylaxwsujdy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkeGlibWVpcmJ5bGF4d3N1amR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTY3OTM3NCwiZXhwIjoyMTAxMjU1Mzc0fQ.7va1rH4RHvSl0YAWXGMo_VcXumbgqgre9FLNvjS8sIg';

async function run() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/SystemLog?select=*`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const data = await res.json();
  console.log('SystemLogs:', data);
}
run();
