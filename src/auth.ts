// ─── Auth: Deep-link OAuth + Subscription Check ─────────────────
import { open } from "@tauri-apps/plugin-shell";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";

const API_BASE = "https://prostyprzetarg.pl";
const AUTH_URL = `${API_BASE}/planer-auth.html`;
const AUTH_STORAGE_KEY = "pp_auth_session";

export interface AuthUser {
  email: string;
  firstName: string;
  lastName: string;
  clerkId: string;
  subscription: {
    plan: string;
    status: string;
    is_active: boolean;
    days_left: number;
    expires_at: string | null;
  };
}

let _user: AuthUser | null = null;

// ─── Saved session ───────────────────────────────────────────────
interface SavedSession {
  email: string;
  clerkId: string;
  savedAt: string;
}

function getSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveSession(email: string, clerkId: string): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    email, clerkId, savedAt: new Date().toISOString(),
  }));
}

function clearSession(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

// ─── API ─────────────────────────────────────────────────────────
async function fetchProfile(email: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/user/profile?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error(`Profil: HTTP ${res.status}`);
  return res.json();
}

// ─── UI helpers ──────────────────────────────────────────────────
function setAuthScreen(html: string): void {
  document.getElementById("auth-screen")!.innerHTML = html;
}

function showAuth(): void {
  document.getElementById("auth-screen")!.classList.remove("hidden");
  (document.querySelector(".app") as HTMLElement).classList.add("hidden");
}

function hideAuth(): void {
  document.getElementById("auth-screen")!.classList.add("hidden");
  (document.querySelector(".app") as HTMLElement).classList.remove("hidden");
}

// ─── Screens ─────────────────────────────────────────────────────
function showLoading(msg = "Ładowanie..."): void {
  showAuth();
  setAuthScreen(`
    <div class="auth-center">
      <div class="auth-logo">
        <img src="/logo.png" alt="Prosty Planer" />
        <h1>Prosty Planer</h1>
      </div>
      <div class="auth-spinner"></div>
      <p class="auth-msg">${msg}</p>
    </div>
  `);
}

function showError(msg: string): void {
  showAuth();
  setAuthScreen(`
    <div class="auth-center">
      <div class="auth-logo">
        <img src="/logo.png" alt="Prosty Planer" />
        <h1>Prosty Planer</h1>
      </div>
      <p class="auth-error">${msg}</p>
      <button class="btn btn-primary auth-retry-btn" id="btn-auth-retry">Spróbuj ponownie</button>
    </div>
  `);
  document.getElementById("btn-auth-retry")!.addEventListener("click", () => location.reload());
}

function showLogin(onSuccess: (u: AuthUser) => void): void {
  showAuth();
  setAuthScreen(`
    <div class="auth-center">
      <div class="auth-logo">
        <img src="/logo.png" alt="Prosty Planer" />
        <h1>Prosty Planer</h1>
        <p class="auth-subtitle">Zaloguj się kontem ProstyPrzetarg.pl</p>
      </div>
      <button class="btn btn-primary auth-login-btn" id="btn-login-browser">
        <i class="fa-solid fa-arrow-up-right-from-square"></i>
        Zaloguj się w przeglądarce
      </button>
      <p class="auth-hint">Kliknij aby otworzyć stronę logowania.<br>Po zalogowaniu wrócisz automatycznie do aplikacji.</p>
    </div>
  `);

  // Listen for deep-link callback
  listenForAuth(onSuccess);

  document.getElementById("btn-login-browser")!.addEventListener("click", async () => {
    try {
      await open(AUTH_URL);
      showLoading("Czekam na logowanie w przeglądarce...");
    } catch {
      showError("Nie udało się otworzyć przeglądarki.");
    }
  });
}

function showPaywall(user: { email: string; clerkId: string }): void {
  showAuth();
  setAuthScreen(`
    <div class="auth-center">
      <div class="auth-logo">
        <img src="/logo.png" alt="Prosty Planer" />
        <h1>Prosty Planer</h1>
      </div>
      <div class="auth-paywall">
        <i class="fa-solid fa-lock auth-paywall-icon"></i>
        <h2>Brak aktywnej subskrypcji</h2>
        <p>Zalogowano jako <strong>${user.email}</strong></p>
        <p>Prosty Planer jest dostępny w ramach subskrypcji ProstyPrzetarg.pl</p>
        <button class="btn btn-primary auth-paywall-btn" id="btn-auth-buy">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> Wykup subskrypcję
        </button>
        <div class="auth-paywall-actions">
          <button class="btn" id="btn-auth-recheck">Sprawdź ponownie</button>
          <button class="btn" id="btn-auth-logout">Wyloguj się</button>
        </div>
      </div>
    </div>
  `);

  document.getElementById("btn-auth-buy")!.addEventListener("click", async () => {
    await open("https://prostyprzetarg.pl/cennik.html");
  });
  document.getElementById("btn-auth-recheck")!.addEventListener("click", () => location.reload());
  document.getElementById("btn-auth-logout")!.addEventListener("click", () => {
    clearSession();
    location.reload();
  });
}

// ─── Deep-link listener ─────────────────────────────────────────
function listenForAuth(onSuccess: (u: AuthUser) => void): void {
  onOpenUrl(async (urls: string[]) => {
    for (const urlStr of urls) {
      if (!urlStr.startsWith("prostyplaner://auth")) continue;

      try {
        const url = new URL(urlStr);
        const email = url.searchParams.get("email");
        const clerkId = url.searchParams.get("clerk_id");

        if (!email) continue;

        showLoading("Sprawdzanie subskrypcji...");

        const profile = await fetchProfile(email);
        const sub = profile.subscription || {
          plan: "free", status: "inactive", is_active: false,
          days_left: 0, expires_at: null,
        };

        if (sub.is_active) {
          saveSession(email, clerkId || "");
          _user = {
            email,
            firstName: profile.first_name || "",
            lastName: profile.last_name || "",
            clerkId: clerkId || "",
            subscription: sub,
          };
          hideAuth();
          onSuccess(_user);
        } else {
          saveSession(email, clerkId || "");
          showPaywall({ email, clerkId: clerkId || "" });
        }
      } catch (err) {
        console.error("Auth callback error:", err);
        showError("Nie udało się zweryfikować konta.");
      }
    }
  });
}

// ─── Verify saved session ────────────────────────────────────────
async function verifySavedSession(
  session: SavedSession,
  onSuccess: (u: AuthUser) => void
): Promise<void> {
  showLoading("Sprawdzanie sesji...");

  try {
    const profile = await fetchProfile(session.email);
    const sub = profile.subscription || {
      plan: "free", status: "inactive", is_active: false,
      days_left: 0, expires_at: null,
    };

    if (sub.is_active) {
      _user = {
        email: session.email,
        firstName: profile.first_name || "",
        lastName: profile.last_name || "",
        clerkId: session.clerkId,
        subscription: sub,
      };
      hideAuth();
      onSuccess(_user);
    } else {
      showPaywall({ email: session.email, clerkId: session.clerkId });
    }
  } catch {
    // No internet — let user in with saved session (offline mode)
    _user = {
      email: session.email,
      firstName: "", lastName: "",
      clerkId: session.clerkId,
      subscription: { plan: "offline", status: "offline", is_active: true, days_left: 0, expires_at: null },
    };
    hideAuth();
    onSuccess(_user);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Initialize auth flow.
 * Calls onReady only when user is signed in AND has active subscription.
 */
export async function initAuth(onReady: (user: AuthUser) => void): Promise<void> {
  showLoading();

  // Check for saved session first
  const saved = getSavedSession();
  if (saved) {
    await verifySavedSession(saved, onReady);
    return;
  }

  // No saved session — show login
  showLogin(onReady);
}

/** Get currently authenticated user (null if not authed) */
export function getAuthUser(): AuthUser | null {
  return _user;
}

/** Sign out and reload */
export async function signOut(): Promise<void> {
  clearSession();
  _user = null;
  location.reload();
}
