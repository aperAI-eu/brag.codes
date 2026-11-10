SELECT encode(sha256(convert_to(COALESCE(string_agg(item, E'\n' ORDER BY item), ''), 'UTF8')), 'hex') AS fingerprint FROM (
 SELECT 'relation:'||c.relname||':'||c.relkind::text||':'||pg_get_userbyid(c.relowner) AS item
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag'
 UNION ALL SELECT 'column:'||c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'')
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='brag' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint:'||c.relname||':'||x.conname||':'||pg_get_constraintdef(x.oid, true)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag'
 UNION ALL SELECT 'index:'||tablename||':'||indexname||':'||indexdef FROM pg_indexes WHERE schemaname='brag'
 UNION ALL SELECT 'function:'||p.proname||':'||pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='brag'
 UNION ALL SELECT 'trigger:'||c.relname||':'||t.tgname||':'||pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='brag' AND NOT t.tgisinternal
 UNION ALL SELECT 'table-grant:'||table_name||':'||grantee||':'||privilege_type||':'||is_grantable FROM information_schema.role_table_grants WHERE table_schema='brag'
 UNION ALL SELECT 'column-grant:'||table_name||':'||column_name||':'||grantee||':'||privilege_type||':'||is_grantable FROM information_schema.role_column_grants WHERE table_schema='brag'
 UNION ALL SELECT 'function-grant:'||p.proname||':'||acl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL unnest(p.proacl) acl WHERE n.nspname='brag'
) schema_items;
