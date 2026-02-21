import type { Category, Material, PriceHistoryEntry, Labor, Zlecenie, ZlecenieItem, ZlecenieStatus, Expense, ExpenseCategory } from "./types";
import { writeTextFile, readTextFile, exists, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

// ─── Storage keys (same as before, for localStorage migration) ──
const MATERIALS_KEY = "pp_materials";
const CATEGORIES_KEY = "pp_categories";
const PRICE_HISTORY_KEY = "pp_price_history";
const LABOR_KEY = "pp_labor";
const ZLECENIA_KEY = "pp_zlecenia";
const TEMPLATES_KEY = "pp_templates";
const COMPANY_KEY = "pp_company";
const EXPENSES_KEY = "pp_expenses";
const ID_COUNTER_KEY = "pp_id_counter";

const DATA_FILENAME = "prostyplaner-data.json";

// ─── In-memory database ─────────────────────────────────────────
interface Database {
  id_counter: number;
  categories: Category[];
  materials: Material[];
  price_history: PriceHistoryEntry[];
  labor: Labor[];
  zlecenia: Zlecenie[];
  templates: ZlecenieTemplate[];
  company: CompanySettings;
  expenses: Expense[];
}

const DEFAULT_COMPANY: CompanySettings = {
  name: "", nip: "", address: "", city: "", zip: "",
  phone: "", email: "", website: "",
  bank_name: "", bank_account: "", logo: "",
};

let db: Database = {
  id_counter: 0,
  categories: [],
  materials: [],
  price_history: [],
  labor: [],
  zlecenia: [],
  templates: [],
  company: { ...DEFAULT_COMPANY },
  expenses: [],
};

let dataFilePath = "";
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

// ─── File I/O ───────────────────────────────────────────────────
async function getDataPath(): Promise<string> {
  if (dataFilePath) return dataFilePath;
  const dir = await appDataDir();
  dataFilePath = await join(dir, DATA_FILENAME);
  return dataFilePath;
}

async function loadFromFile(): Promise<Database | null> {
  try {
    const path = await getDataPath();
    const dir = await appDataDir();
    // Ensure directory exists
    const dirExists = await exists(dir);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }
    const fileExists = await exists(path);
    if (!fileExists) return null;
    const raw = await readTextFile(path);
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load data file:", e);
    return null;
  }
}

function scheduleSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveToFile();
  }, 300); // Debounce 300ms
}

async function saveToFile(): Promise<void> {
  try {
    const path = await getDataPath();
    const json = JSON.stringify(db, null, 2);
    await writeTextFile(path, json);
  } catch (e) {
    console.error("Failed to save data file:", e);
    // Fallback: also save to localStorage as backup
    try {
      localStorage.setItem("pp_backup", JSON.stringify(db));
    } catch {}
  }
}

// ─── Migration from localStorage ────────────────────────────────
function migrateFromLocalStorage(): Database | null {
  // Check if there's any data in localStorage
  const hasData = localStorage.getItem(CATEGORIES_KEY) ||
                  localStorage.getItem(MATERIALS_KEY) ||
                  localStorage.getItem(LABOR_KEY) ||
                  localStorage.getItem(ZLECENIA_KEY);

  if (!hasData) return null;

  console.log("Migrating data from localStorage to JSON file...");

  function loadLS<T>(key: string): T[] {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
  }

  let company: CompanySettings;
  try {
    const raw = localStorage.getItem(COMPANY_KEY);
    company = raw ? { ...DEFAULT_COMPANY, ...JSON.parse(raw) } : { ...DEFAULT_COMPANY };
  } catch {
    company = { ...DEFAULT_COMPANY };
  }

  const migrated: Database = {
    id_counter: parseInt(localStorage.getItem(ID_COUNTER_KEY) || "0", 10),
    categories: loadLS<Category>(CATEGORIES_KEY),
    materials: loadLS<Material>(MATERIALS_KEY),
    price_history: loadLS<PriceHistoryEntry>(PRICE_HISTORY_KEY),
    labor: loadLS<Labor>(LABOR_KEY),
    zlecenia: loadLS<Zlecenie>(ZLECENIA_KEY),
    templates: loadLS<ZlecenieTemplate>(TEMPLATES_KEY),
    company,
    expenses: loadLS<Expense>(EXPENSES_KEY),
  };

  // Mark migration done — keep localStorage intact as backup
  localStorage.setItem("pp_migrated_to_file", "true");

  return migrated;
}

// ─── ID generator ────────────────────────────────────────────────
function nextId(): number {
  db.id_counter++;
  scheduleSave();
  return db.id_counter;
}

// ─── Seed defaults ───────────────────────────────────────────────
function seedDefaults(): void {
  if (db.categories.length > 0) return;

  db.categories = [
    { id: nextId(), name: "Materiały budowlane", color: "#EF4444", sort_order: 1 },
    { id: nextId(), name: "Instalacja elektryczna", color: "#F59E0B", sort_order: 2 },
    { id: nextId(), name: "Instalacja sanitarna", color: "#3B82F6", sort_order: 3 },
    { id: nextId(), name: "Wykończenie", color: "#10B981", sort_order: 4 },
    { id: nextId(), name: "Narzędzia", color: "#8B5CF6", sort_order: 5 },
    { id: nextId(), name: "Transport", color: "#6B7280", sort_order: 6 },
    { id: nextId(), name: "Inne", color: "#9CA3AF", sort_order: 99 },
  ];

  const cats = db.categories;
  db.materials = [
    { id: nextId(), name: "Kabel YDY 3x2.5", unit: "m", price_netto: 4.5, vat_rate: 23, category_id: cats[1].id, supplier: "Elektroskandia", sku: "YDY-3x2.5", url: JSON.stringify([{ label: "Katalog", url: "https://elektroskandia.pl/ydy" }, { label: "Allegro", url: "https://allegro.pl/kabel-ydy" }]), notes: "", is_favorite: true, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Puszka natynkowa PK-1", unit: "szt", price_netto: 2.8, vat_rate: 23, category_id: cats[1].id, supplier: "Ospel", sku: "PK1-N", url: JSON.stringify([{ label: "Producent", url: "https://ospel.com.pl/pk1" }]), notes: "", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Cement CEM I 42.5R (25kg)", unit: "szt", price_netto: 16.5, vat_rate: 23, category_id: cats[0].id, supplier: "Castorama", sku: "", url: "[]", notes: "Worek 25kg", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Rura PEX 16x2.0", unit: "m", price_netto: 3.2, vat_rate: 23, category_id: cats[2].id, supplier: "Wavin", sku: "PEX-16", url: JSON.stringify([{ label: "Wavin.pl", url: "https://wavin.pl/pex16" }]), notes: "", is_favorite: true, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Gładź szpachlowa Knauf (20kg)", unit: "szt", price_netto: 36.0, vat_rate: 23, category_id: cats[3].id, supplier: "Knauf", sku: "K-FINISH", url: "[]", notes: "", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Wyłącznik nadprądowy B16 1P", unit: "szt", price_netto: 12.5, vat_rate: 23, category_id: cats[1].id, supplier: "Hager", sku: "MBN116E", url: JSON.stringify([{ label: "Karta", url: "https://hager.com/mbn116e" }]), notes: "", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Farba lateksowa biała 10L", unit: "szt", price_netto: 89.0, vat_rate: 23, category_id: cats[3].id, supplier: "Leroy Merlin", sku: "FL-10L-W", url: JSON.stringify([{ label: "Sklep", url: "https://leroymerlin.pl/farba" }]), notes: "Wydajność ok. 12m²/L", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];

  scheduleSave();
}

function seedLabor(): void {
  if (db.labor.length > 0) return;

  db.labor = [
    { id: nextId(), name: "Malowanie ścian", unit: "m2", price_netto: 25, vat_rate: 23, category: "Malowanie", notes: "Emulsja, 2 warstwy", is_favorite: true, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Malowanie sufitów", unit: "m2", price_netto: 30, vat_rate: 23, category: "Malowanie", notes: "Emulsja, 2 warstwy", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Gładzie szpachlowe", unit: "m2", price_netto: 35, vat_rate: 23, category: "Wykończenie", notes: "Z gruntowaniem", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Układanie paneli", unit: "m2", price_netto: 40, vat_rate: 23, category: "Podłogi", notes: "", is_favorite: true, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Montaż gniazdka", unit: "szt", price_netto: 60, vat_rate: 23, category: "Elektryka", notes: "Z podłączeniem", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Montaż punktu oświetleniowego", unit: "szt", price_netto: 80, vat_rate: 23, category: "Elektryka", notes: "", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Montaż baterii umywalkowej", unit: "szt", price_netto: 120, vat_rate: 23, category: "Hydraulika", notes: "", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Układanie płytek", unit: "m2", price_netto: 90, vat_rate: 23, category: "Wykończenie", notes: "Bez fugowania", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: nextId(), name: "Roboczogodzina pomocnika", unit: "godz", price_netto: 35, vat_rate: 23, category: "Ogólne", notes: "", is_favorite: false, is_archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];

  scheduleSave();
}

function seedZlecenia(): void {
  if (db.zlecenia.length > 0) return;

  const mats = db.materials;
  const labors = db.labor;

  db.zlecenia = [{
    id: nextId(),
    name: "Wykończenie mieszkania ul. Kwiatowa 5",
    client: "Jan Kowalski",
    status: "wycena",
    notes: "Mieszkanie 55m², 2 pokoje + kuchnia + łazienka",
    markup_materials: 15,
    markup_labor: 0,
    date_start: "2026-03-01",
    date_end: "2026-04-15",
    items: [
      { id: nextId(), type: "labor", source_id: labors[0]?.id ?? null, name: "Malowanie ścian", unit: "m2", quantity: 120, price_netto: 25, vat_rate: 23, notes: "" },
      { id: nextId(), type: "labor", source_id: labors[2]?.id ?? null, name: "Gładzie szpachlowe", unit: "m2", quantity: 120, price_netto: 35, vat_rate: 23, notes: "" },
      { id: nextId(), type: "material", source_id: mats[6]?.id ?? null, name: "Farba lateksowa biała 10L", unit: "szt", quantity: 5, price_netto: 89, vat_rate: 23, notes: "" },
      { id: nextId(), type: "labor", source_id: labors[3]?.id ?? null, name: "Układanie paneli", unit: "m2", quantity: 40, price_netto: 40, vat_rate: 23, notes: "" },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }];

  scheduleSave();
}

function seedExpenses(): void {
  if (db.expenses.length > 0) return;

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 7);

  db.expenses = [
    { id: nextId(), name: "Farba Dulux biała 10L x3", amount: 420, category: "materialy", zlecenie_id: null, date: `${thisMonth}-03`, notes: "", created_at: now.toISOString() },
    { id: nextId(), name: "Paliwo - dojazd na budowę", amount: 180, category: "paliwo", zlecenie_id: null, date: `${thisMonth}-05`, notes: "Kwiatowa 5", created_at: now.toISOString() },
    { id: nextId(), name: "Wiertarka udarowa Bosch", amount: 650, category: "narzedzia", zlecenie_id: null, date: `${lastMonth}-12`, notes: "", created_at: now.toISOString() },
    { id: nextId(), name: "Elektryk - podwykonawca", amount: 2800, category: "podwykonawcy", zlecenie_id: null, date: `${lastMonth}-20`, notes: "Instalacja w łazience", created_at: now.toISOString() },
    { id: nextId(), name: "Papier, tonery, segregatory", amount: 95, category: "biuro", zlecenie_id: null, date: `${thisMonth}-01`, notes: "", created_at: now.toISOString() },
  ];

  scheduleSave();
}

// ─── Categories ──────────────────────────────────────────────────
export function getCategories(): Category[] {
  return [...db.categories].sort((a, b) => a.sort_order - b.sort_order);
}

export function addCategory(name: string, color: string): Category {
  const cat: Category = { id: nextId(), name, color, sort_order: db.categories.length + 1 };
  db.categories.push(cat);
  scheduleSave();
  return cat;
}

export function updateCategory(id: number, name: string, color: string): void {
  const cat = db.categories.find((c) => c.id === id);
  if (cat) {
    cat.name = name;
    cat.color = color;
    scheduleSave();
  }
}

export function deleteCategory(id: number): void {
  db.categories = db.categories.filter((c) => c.id !== id);
  db.materials.forEach((m) => {
    if (m.category_id === id) m.category_id = null;
  });
  scheduleSave();
}

export function getCategoryById(id: number | null): Category | undefined {
  if (id === null) return undefined;
  return db.categories.find((c) => c.id === id);
}

// ─── Materials ───────────────────────────────────────────────────
export interface MaterialFilter {
  search?: string;
  category_id?: number | null;
  favorites_only?: boolean;
  show_archived?: boolean;
}

export function getMaterials(filter: MaterialFilter = {}): Material[] {
  let mats = [...db.materials];

  if (!filter.show_archived) mats = mats.filter((m) => !m.is_archived);
  if (filter.favorites_only) mats = mats.filter((m) => m.is_favorite);
  if (filter.category_id !== undefined && filter.category_id !== null) {
    mats = mats.filter((m) => m.category_id === filter.category_id);
  }
  if (filter.search) {
    const s = filter.search.toLowerCase();
    mats = mats.filter(
      (m) =>
        m.name.toLowerCase().includes(s) ||
        m.supplier.toLowerCase().includes(s) ||
        m.sku.toLowerCase().includes(s)
    );
  }

  mats.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return a.name.localeCompare(b.name, "pl");
  });

  return mats;
}

export function getAllMaterialsCount(): { total: number; favorites: number; archived: number } {
  return {
    total: db.materials.filter((m) => !m.is_archived).length,
    favorites: db.materials.filter((m) => m.is_favorite && !m.is_archived).length,
    archived: db.materials.filter((m) => m.is_archived).length,
  };
}

export function getMaterialCountByCategory(catId: number): number {
  return db.materials.filter((m) => m.category_id === catId && !m.is_archived).length;
}

export interface MaterialInput {
  name: string;
  unit: string;
  price_netto: number;
  vat_rate: number;
  category_id: number | null;
  supplier: string;
  sku: string;
  url: string;
  notes: string;
}

export function addMaterial(input: MaterialInput): Material {
  const now = new Date().toISOString();
  const mat: Material = {
    id: nextId(),
    ...input,
    is_favorite: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };
  db.materials.push(mat);
  addPriceHistory(mat.id, mat.price_netto);
  scheduleSave();
  return mat;
}

export function updateMaterial(id: number, input: MaterialInput): void {
  const mat = db.materials.find((m) => m.id === id);
  if (!mat) return;

  const priceChanged = Math.abs(mat.price_netto - input.price_netto) > 0.001;
  Object.assign(mat, input, { updated_at: new Date().toISOString() });

  if (priceChanged) addPriceHistory(id, input.price_netto);
  scheduleSave();
}

export function deleteMaterial(id: number): void {
  db.materials = db.materials.filter((m) => m.id !== id);
  db.price_history = db.price_history.filter((h) => h.material_id !== id);
  scheduleSave();
}

export function toggleFavorite(id: number): void {
  const mat = db.materials.find((m) => m.id === id);
  if (mat) {
    mat.is_favorite = !mat.is_favorite;
    mat.updated_at = new Date().toISOString();
    scheduleSave();
  }
}

export function archiveMaterial(id: number): void {
  const mat = db.materials.find((m) => m.id === id);
  if (mat) {
    mat.is_archived = true;
    mat.updated_at = new Date().toISOString();
    scheduleSave();
  }
}

// ─── Price history ───────────────────────────────────────────────
function addPriceHistory(materialId: number, price: number): void {
  db.price_history.push({
    id: nextId(),
    material_id: materialId,
    price_netto: price,
    changed_at: new Date().toISOString(),
  });
}

export function getPriceHistory(materialId: number): PriceHistoryEntry[] {
  return db.price_history
    .filter((h) => h.material_id === materialId)
    .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
}

// ─── Labor (Robocizny) ──────────────────────────────────────────
export interface LaborFilter {
  search?: string;
  category?: string;
  favorites_only?: boolean;
  show_archived?: boolean;
}

export function getLabor(filter: LaborFilter = {}): Labor[] {
  let items = [...db.labor];

  if (!filter.show_archived) items = items.filter((l) => !l.is_archived);
  if (filter.favorites_only) items = items.filter((l) => l.is_favorite);
  if (filter.category) items = items.filter((l) => l.category === filter.category);
  if (filter.search) {
    const s = filter.search.toLowerCase();
    items = items.filter(
      (l) =>
        l.name.toLowerCase().includes(s) ||
        l.category.toLowerCase().includes(s) ||
        l.notes.toLowerCase().includes(s)
    );
  }

  items.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return a.name.localeCompare(b.name, "pl");
  });

  return items;
}

export function getLaborCategories(): string[] {
  const items = db.labor.filter((l) => !l.is_archived);
  const cats = new Set(items.map((l) => l.category).filter(Boolean));
  return [...cats].sort((a, b) => a.localeCompare(b, "pl"));
}

export function getAllLaborCount(): { total: number; favorites: number; archived: number } {
  return {
    total: db.labor.filter((l) => !l.is_archived).length,
    favorites: db.labor.filter((l) => l.is_favorite && !l.is_archived).length,
    archived: db.labor.filter((l) => l.is_archived).length,
  };
}

export interface LaborInput {
  name: string;
  unit: string;
  price_netto: number;
  vat_rate: number;
  category: string;
  notes: string;
}

export function addLabor(input: LaborInput): Labor {
  const now = new Date().toISOString();
  const item: Labor = {
    id: nextId(),
    ...input,
    is_favorite: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };
  db.labor.push(item);
  scheduleSave();
  return item;
}

export function updateLabor(id: number, input: LaborInput): void {
  const item = db.labor.find((l) => l.id === id);
  if (!item) return;
  Object.assign(item, input, { updated_at: new Date().toISOString() });
  scheduleSave();
}

export function deleteLabor(id: number): void {
  db.labor = db.labor.filter((l) => l.id !== id);
  scheduleSave();
}

export function toggleLaborFavorite(id: number): void {
  const item = db.labor.find((l) => l.id === id);
  if (item) {
    item.is_favorite = !item.is_favorite;
    item.updated_at = new Date().toISOString();
    scheduleSave();
  }
}

export function archiveLabor(id: number): void {
  const item = db.labor.find((l) => l.id === id);
  if (item) {
    item.is_archived = true;
    item.updated_at = new Date().toISOString();
    scheduleSave();
  }
}

// ─── Zlecenia (Orders / Quotes) ─────────────────────────────────
export function getZlecenia(): Zlecenie[] {
  return [...db.zlecenia].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export function getZlecenieById(id: number): Zlecenie | undefined {
  return db.zlecenia.find((z) => z.id === id);
}

export interface ZlecenieInput {
  name: string;
  client: string;
  status: string;
  notes: string;
  markup_materials: number;
  markup_labor: number;
  date_start: string;
  date_end: string;
}

export function addZlecenie(input: ZlecenieInput): Zlecenie {
  const now = new Date().toISOString();
  const z: Zlecenie = {
    id: nextId(),
    ...input,
    status: (input.status as Zlecenie["status"]) || "wycena",
    items: [],
    created_at: now,
    updated_at: now,
  };
  db.zlecenia.push(z);
  scheduleSave();
  return z;
}

export function updateZlecenie(id: number, input: ZlecenieInput): void {
  const z = db.zlecenia.find((x) => x.id === id);
  if (!z) return;
  z.name = input.name;
  z.client = input.client;
  z.status = (input.status as Zlecenie["status"]) || z.status;
  z.notes = input.notes;
  z.markup_materials = input.markup_materials;
  z.markup_labor = input.markup_labor;
  z.date_start = input.date_start;
  z.date_end = input.date_end;
  z.updated_at = new Date().toISOString();
  scheduleSave();
}

export function deleteZlecenie(id: number): void {
  db.zlecenia = db.zlecenia.filter((z) => z.id !== id);
  scheduleSave();
}

export function duplicateZlecenie(id: number): Zlecenie | null {
  const original = db.zlecenia.find((z) => z.id === id);
  if (!original) return null;

  const now = new Date().toISOString();
  const copy: Zlecenie = {
    id: nextId(),
    name: original.name + " (kopia)",
    client: original.client,
    status: "wycena",
    notes: original.notes,
    markup_materials: original.markup_materials,
    markup_labor: original.markup_labor,
    date_start: "",
    date_end: "",
    items: original.items.map((item) => ({ ...item, id: nextId() })),
    created_at: now,
    updated_at: now,
  };

  db.zlecenia.push(copy);
  scheduleSave();
  return copy;
}

export function setZlecenieStatus(id: number, status: Zlecenie["status"]): void {
  const z = db.zlecenia.find((x) => x.id === id);
  if (!z) return;
  z.status = status;
  z.updated_at = new Date().toISOString();
  scheduleSave();
}

export function addZlecenieItem(zlecenieId: number, item: Omit<ZlecenieItem, "id">): ZlecenieItem {
  const z = db.zlecenia.find((x) => x.id === zlecenieId);
  if (!z) throw new Error("Zlecenie not found");
  const newItem: ZlecenieItem = { id: nextId(), ...item };
  z.items.push(newItem);
  z.updated_at = new Date().toISOString();
  scheduleSave();
  return newItem;
}

export function updateZlecenieItem(zlecenieId: number, itemId: number, updates: Partial<ZlecenieItem>): void {
  const z = db.zlecenia.find((x) => x.id === zlecenieId);
  if (!z) return;
  const item = z.items.find((i) => i.id === itemId);
  if (!item) return;
  Object.assign(item, updates);
  z.updated_at = new Date().toISOString();
  scheduleSave();
}

export function removeZlecenieItem(zlecenieId: number, itemId: number): void {
  const z = db.zlecenia.find((x) => x.id === zlecenieId);
  if (!z) return;
  z.items = z.items.filter((i) => i.id !== itemId);
  z.updated_at = new Date().toISOString();
  scheduleSave();
}

export function reorderZlecenieItems(zlecenieId: number, orderedItemIds: number[]): void {
  const z = db.zlecenia.find((x) => x.id === zlecenieId);
  if (!z) return;

  const byId = new Map(z.items.map((i) => [i.id, i]));
  const reordered: ZlecenieItem[] = [];
  for (const id of orderedItemIds) {
    const item = byId.get(id);
    if (item) reordered.push(item);
  }
  for (const item of z.items) {
    if (!orderedItemIds.includes(item.id)) reordered.push(item);
  }

  z.items = reordered;
  z.updated_at = new Date().toISOString();
  scheduleSave();
}

export function refreshZleceniePrices(zlecenieId: number): number {
  const z = db.zlecenia.find((x) => x.id === zlecenieId);
  if (!z) return 0;

  let updated = 0;

  for (const item of z.items) {
    if (!item.source_id) continue;

    if (item.type === "material") {
      const mat = db.materials.find((m) => m.id === item.source_id);
      if (mat && mat.price_netto !== item.price_netto) {
        item.price_netto = mat.price_netto;
        item.name = mat.name;
        item.unit = mat.unit;
        item.vat_rate = mat.vat_rate;
        updated++;
      }
    } else {
      const lab = db.labor.find((l) => l.id === item.source_id);
      if (lab && lab.price_netto !== item.price_netto) {
        item.price_netto = lab.price_netto;
        item.name = lab.name;
        item.unit = lab.unit;
        item.vat_rate = lab.vat_rate;
        updated++;
      }
    }
  }

  if (updated > 0) {
    z.updated_at = new Date().toISOString();
    scheduleSave();
  }

  return updated;
}

export function getNextItemId(): number {
  return nextId();
}

// ─── Templates ──────────────────────────────────────────────────
export interface ZlecenieTemplate {
  id: number;
  name: string;
  markup_materials: number;
  markup_labor: number;
  items: Omit<ZlecenieItem, "id">[];
  created_at: string;
}

export function getTemplates(): ZlecenieTemplate[] {
  return [...db.templates].sort(
    (a, b) => a.name.localeCompare(b.name, "pl")
  );
}

export function saveAsTemplate(zlecenieId: number, templateName: string): ZlecenieTemplate | null {
  const z = db.zlecenia.find((x) => x.id === zlecenieId);
  if (!z) return null;

  const tmpl: ZlecenieTemplate = {
    id: nextId(),
    name: templateName,
    markup_materials: z.markup_materials || 0,
    markup_labor: z.markup_labor || 0,
    items: z.items.map(({ id, ...rest }) => rest),
    created_at: new Date().toISOString(),
  };
  db.templates.push(tmpl);
  scheduleSave();
  return tmpl;
}

export function createFromTemplate(templateId: number, name: string, client: string): Zlecenie | null {
  const tmpl = db.templates.find((t) => t.id === templateId);
  if (!tmpl) return null;

  const now = new Date().toISOString();
  const z: Zlecenie = {
    id: nextId(),
    name,
    client,
    status: "wycena",
    notes: "",
    markup_materials: tmpl.markup_materials,
    markup_labor: tmpl.markup_labor,
    date_start: "",
    date_end: "",
    items: tmpl.items.map((item) => ({ ...item, id: nextId() })),
    created_at: now,
    updated_at: now,
  };
  db.zlecenia.push(z);
  scheduleSave();
  return z;
}

export function deleteTemplate(id: number): void {
  db.templates = db.templates.filter((t) => t.id !== id);
  scheduleSave();
}

// ─── Company Settings ───────────────────────────────────────────
export interface CompanySettings {
  name: string;
  nip: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  bank_name: string;
  bank_account: string;
  logo: string;
}

export function getCompany(): CompanySettings {
  return { ...DEFAULT_COMPANY, ...db.company };
}

export function saveCompany(settings: CompanySettings): void {
  db.company = { ...settings };
  scheduleSave();
}

// ─── Expenses ───────────────────────────────────────────────────
export const EXPENSE_CATEGORIES: Record<ExpenseCategory, { label: string; color: string; icon: string }> = {
  materialy:      { label: "Materiały",      color: "#f5a623", icon: "fa-solid fa-boxes-stacked" },
  narzedzia:      { label: "Narzędzia",      color: "#8b5cf6", icon: "fa-solid fa-screwdriver-wrench" },
  paliwo:         { label: "Paliwo",         color: "#e5484d", icon: "fa-solid fa-gas-pump" },
  podwykonawcy:   { label: "Podwykonawcy",   color: "#667eea", icon: "fa-solid fa-people-carry-box" },
  biuro:          { label: "Biuro",          color: "#30a46c", icon: "fa-solid fa-building" },
  inne:           { label: "Inne",           color: "#555870", icon: "fa-solid fa-ellipsis" },
};

export interface ExpenseInput {
  name: string;
  amount: number;
  category: ExpenseCategory;
  zlecenie_id: number | null;
  date: string;
  notes: string;
}

export function getExpenses(month?: string): Expense[] {
  let list = [...db.expenses];
  if (month) {
    list = list.filter((e) => e.date.startsWith(month));
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export function getExpensesForZlecenie(zlecenieId: number): Expense[] {
  return db.expenses
    .filter((e) => e.zlecenie_id === zlecenieId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function addExpense(input: ExpenseInput): Expense {
  const e: Expense = {
    id: nextId(),
    ...input,
    created_at: new Date().toISOString(),
  };
  db.expenses.push(e);
  scheduleSave();
  return e;
}

export function updateExpense(id: number, input: ExpenseInput): void {
  const e = db.expenses.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, input);
  scheduleSave();
}

export function deleteExpense(id: number): void {
  db.expenses = db.expenses.filter((e) => e.id !== id);
  scheduleSave();
}

export function getExpensesTotalByMonth(): Record<string, number> {
  const byMonth: Record<string, number> = {};
  for (const e of db.expenses) {
    const m = e.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + e.amount;
  }
  return byMonth;
}

export function getExpensesTotalByCategory(month?: string): Record<string, number> {
  const list = month ? db.expenses.filter((e) => e.date.startsWith(month)) : db.expenses;
  const byCat: Record<string, number> = {};
  for (const e of list) {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  }
  return byCat;
}

export function getRevenueByMonth(): Record<string, number> {
  const byMonth: Record<string, number> = {};
  for (const z of db.zlecenia) {
    const status = z.status || "wycena";
    if (status !== "zaakceptowane" && status !== "realizacja") continue;
    const m = z.updated_at.slice(0, 7);
    let total = 0;
    for (const item of z.items) {
      const markupPct = item.type === "material" ? (z.markup_materials || 0) : (z.markup_labor || 0);
      total += item.price_netto * (1 + markupPct / 100) * item.quantity * (1 + item.vat_rate / 100);
    }
    byMonth[m] = (byMonth[m] || 0) + total;
  }
  return byMonth;
}

// ─── Init (ASYNC — must be awaited before app renders) ──────────
export async function initStore(): Promise<void> {
  if (initialized) return;

  // 1. Try loading from JSON file
  const fileData = await loadFromFile();
  if (fileData) {
    db = fileData;
    initialized = true;
    console.log("Data loaded from JSON file");
    return;
  }

  // 2. Try migrating from localStorage
  const lsData = migrateFromLocalStorage();
  if (lsData) {
    db = lsData;
    initialized = true;
    await saveToFile();
    console.log("Data migrated from localStorage to JSON file");
    return;
  }

  // 3. Fresh install — seed defaults
  seedDefaults();
  seedLabor();
  seedZlecenia();
  seedExpenses();
  initialized = true;
  await saveToFile();
  console.log("Fresh install — seeded defaults");
}
