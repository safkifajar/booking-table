-- Debug query: cek table mana yang ada di publication supabase_realtime
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
