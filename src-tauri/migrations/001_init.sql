-- Prosty Planer — Migration 001
-- Na razie dane w localStorage, ten plik jest gotowy na przejście na SQLite

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#667eea',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'szt',
    price_netto REAL NOT NULL DEFAULT 0,
    vat_rate INTEGER NOT NULL DEFAULT 23,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    supplier TEXT DEFAULT '',
    sku TEXT DEFAULT '',
    url TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    is_favorite BOOLEAN DEFAULT 0,
    is_archived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    price_netto REAL NOT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(name);
CREATE INDEX IF NOT EXISTS idx_materials_archived ON materials(is_archived);
CREATE INDEX IF NOT EXISTS idx_price_history_material ON price_history(material_id);

-- Domyślne kategorie
INSERT INTO categories (name, color, sort_order) VALUES
    ('Materiały budowlane', '#EF4444', 1),
    ('Instalacja elektryczna', '#F59E0B', 2),
    ('Instalacja sanitarna', '#3B82F6', 3),
    ('Wykończenie', '#10B981', 4),
    ('Narzędzia', '#8B5CF6', 5),
    ('Transport', '#6B7280', 6),
    ('Inne', '#9CA3AF', 99);
