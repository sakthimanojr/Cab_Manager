CREATE TABLE IF NOT EXISTS vehicles(id SERIAL PRIMARY KEY, reg_no TEXT UNIQUE NOT NULL, make TEXT, model TEXT, fuel_type TEXT DEFAULT 'Petrol', tank_capacity NUMERIC, current_odometer NUMERIC, insurance_expiry DATE, permit_expiry DATE, puc_expiry DATE);
CREATE TABLE IF NOT EXISTS drivers(id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, joined DATE, status TEXT DEFAULT 'Active', notes TEXT);
CREATE TABLE IF NOT EXISTS trips(id SERIAL PRIMARY KEY, trip_code TEXT UNIQUE, vehicle_id INT NOT NULL REFERENCES vehicles(id), driver_id INT REFERENCES drivers(id),
 status TEXT NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress','Completed','Needs Review','Cancelled')),
 start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, start_lat NUMERIC, start_lng NUMERIC, end_lat NUMERIC, end_lng NUMERIC, start_loc TEXT, end_loc TEXT,
 start_odo NUMERIC, end_odo NUMERIC, distance NUMERIC, fuel_type TEXT, fare NUMERIC NOT NULL DEFAULT 0, notes TEXT, flags TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip ON trips(vehicle_id) WHERE status='In Progress';
CREATE INDEX IF NOT EXISTS trips_start ON trips(start_time);
CREATE TABLE IF NOT EXISTS trip_photos(id SERIAL PRIMARY KEY, trip_id INT NOT NULL REFERENCES trips(id), kind TEXT NOT NULL CHECK (kind IN ('start','end')), file_path TEXT NOT NULL,
 sha256 TEXT UNIQUE NOT NULL, taken_at TIMESTAMPTZ, uploaded_at TIMESTAMPTZ DEFAULT now(), extracted JSONB, UNIQUE(trip_id,kind));
CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY, trip_id INT NOT NULL REFERENCES trips(id), amount NUMERIC NOT NULL CHECK (amount>0), method TEXT DEFAULT 'Cash', paid_at TIMESTAMPTZ DEFAULT now(), note TEXT);
CREATE TABLE IF NOT EXISTS fuel_logs(id SERIAL PRIMARY KEY, date DATE NOT NULL, vehicle_id INT NOT NULL REFERENCES vehicles(id), odometer NUMERIC, fuel_type TEXT NOT NULL, quantity NUMERIC CHECK (quantity IS NULL OR quantity>0),
 price_per_unit NUMERIC, total NUMERIC, station TEXT, method TEXT, full_tank BOOLEAN DEFAULT false, notes TEXT);
CREATE TABLE IF NOT EXISTS maintenance(id SERIAL PRIMARY KEY, vehicle_id INT NOT NULL REFERENCES vehicles(id), service_date DATE NOT NULL, odometer NUMERIC, service_type TEXT NOT NULL, description TEXT,
 amount NUMERIC DEFAULT 0, next_date DATE, next_odo NUMERIC, status TEXT DEFAULT 'Done', receipt_path TEXT);
CREATE TABLE IF NOT EXISTS expenses(id SERIAL PRIMARY KEY, date DATE NOT NULL, category TEXT NOT NULL CHECK (lower(category)<>'fuel'), description TEXT, amount NUMERIC NOT NULL CHECK (amount>=0),
 method TEXT, vehicle_id INT REFERENCES vehicles(id), receipt_path TEXT, notes TEXT, maintenance_id INT UNIQUE REFERENCES maintenance(id));
CREATE TABLE IF NOT EXISTS admin_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), actor TEXT DEFAULT 'app', action TEXT, entity TEXT, entity_id INT, detail JSONB);
