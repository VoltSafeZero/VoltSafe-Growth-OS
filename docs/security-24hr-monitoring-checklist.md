VoltSafe CMS — 24-Hour Post-Deploy Watch

Monitor:
1. Any 500s on:
   - /api/board-packs/*
   - /api/capital/*
   - /api/admin/users/*
   - /api/currents/*
   - /api/today/ceo-*
   - /api/gmail/*

2. Any migration errors:
   - security_audit_events
   - board_packs
   - ceo_action_queue
   - ceo_execution_reviews
   - ceo_forecast_notes

3. Any unexpected permission behavior:
   - normal admin accessing Board Pack
   - non-capital user accessing Capital
   - non-member seeing private Currents/DM content

4. Any high-risk action issues:
   - Board Pack finalize/archive
   - Capital portal revoke/regenerate/delete
   - Admin user delete
   - Gmail disconnect
   - Currents membership changes

5. Any audit table issues:
   - failed inserts
   - sensitive payloads accidentally logged
   - unexpected spike in events

Rollback only if:
- login/session breaks
- core app/Today/CRM fails
- restricted data is exposed
- widespread 500s appear
- migration blocks startup
- confirmation layer blocks critical admin operations
