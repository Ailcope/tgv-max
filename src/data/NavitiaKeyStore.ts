import { NAVITIA_KEY_STORAGE } from "@/config";

/** The slice of `localStorage` this store needs (injectable, absent outside browsers). */
export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage` when it exists and is usable (private mode can throw). */
function browserStorage(): KeyStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Where the user's SNCF API token lives. Two sources, build-time first:
 * `VITE_SNCF_API_KEY` for a self-hosted deployment, otherwise whatever the user
 * pasted in the UI. The token never leaves the browser except toward the SNCF API.
 */
export class NavitiaKeyStore {
  constructor(
    private readonly storage: KeyStorage | null = browserStorage(),
    private readonly buildTimeKey: string = String(import.meta.env.VITE_SNCF_API_KEY ?? ""),
  ) {}

  /** The token to use, or `null` when none is configured. */
  get(): string | null {
    const stored = this.storage?.getItem(NAVITIA_KEY_STORAGE)?.trim();
    return stored || this.buildTimeKey.trim() || null;
  }

  /** True when the key comes from the build and cannot be edited from the UI. */
  get isBuiltIn(): boolean {
    return !this.storage?.getItem(NAVITIA_KEY_STORAGE)?.trim() && !!this.buildTimeKey.trim();
  }

  set(token: string): void {
    const clean = token.trim();
    if (clean) this.storage?.setItem(NAVITIA_KEY_STORAGE, clean);
    else this.clear();
  }

  clear(): void {
    this.storage?.removeItem(NAVITIA_KEY_STORAGE);
  }
}
