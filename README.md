# Cab Trip Manager
Driver uploads two geotagged dashboard photos per trip; the app extracts time, GPS, odometer and fuel type (EXIF + Tesseract OCR), computes distance/duration, and feeds reports. No driver login; Dashboard, Monthly Report and Settings need the admin password (verified server-side, bcrypt hash, 5-attempt lockout, idle auto-lock).

## Setup
1. `createdb cabtrips` (PostgreSQL 14+). The schema is applied automatically on API start (`database/schema.sql`).
2. `cp .env.example backend/.env`, set `DATABASE_URL`, a long `JWT_SECRET`, and `ADMIN_INITIAL_PASSWORD` (hashed on first start; remove it from `.env` afterwards. Change it later in Settings).
3. `cd backend && npm install && npm start`  (Tesseract downloads English language data on first OCR run, so the server needs internet once).
4. `cd frontend && npm install && npm run dev`, then open http://localhost:5173 (on a phone, use your PC's LAN IP; camera capture on mobile browsers needs HTTPS).

## Production
`cd frontend && npm run build`; the API serves `frontend/dist` automatically. Deploy the API on Render/any Node host with a managed PostgreSQL, behind HTTPS, with a persistent disk (or swap `uploads/` for object storage). Set `TZ` to your timezone.

## Behaviour notes
- Start vs end is decided by trip state, never by the driver. A second start while a trip is active is refused (DB unique index); two devices ending the same trip are guarded by a conditional UPDATE.
- Duplicate photos are rejected by SHA-256. Unreliable odometer (<70% OCR confidence) or missing timestamp triggers a confirmation form; nothing is guessed. Time conflicts, missing GPS, decreasing odometer and end-before-start set "Needs Review"; admins fix via `PUT /api/trips/:id/correct`.
- All raw extraction results (EXIF time, overlay time, OCR text, confidences) are stored in `trip_photos.extracted`, plus upload time.
- Fuel is only entered in the Fuel Log (Expense Log rejects "Fuel"); maintenance can create one linked expense (unique constraint prevents duplicates).
- Deletes are admin-only; trip delete = Cancelled. All changes are written to `audit_logs`.

## Tests to run with real photos
Start/end flow; same photo twice (409); end with no active trip (409); blurry odometer (confirmation form); photo with no EXIF (manual time); odometer decrease (Needs Review); wrong admin password x6 (lockout); call `/api/dashboard` without token (401); fuel + expense totals in Daily Report; restart server and confirm data persists.

## Not included yet
PDF reports, in-app backup/restore (use `pg_dump` + copy `backend/uploads/`), receipt photo upload, charts library (simple bar charts are used), and tuning OCR regexes against your real overlay layout.
