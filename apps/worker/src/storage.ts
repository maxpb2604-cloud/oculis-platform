/**
 * Pluggable document storage backend.
 *
 * The official initiative PDFs ultimately live in the Ferdinand Herrera SharePoint
 * "DataBank". Each archived filename includes the initiative code and source document
 * id so several official files for one initiative remain distinct. To avoid blocking on SharePoint credentials, the
 * default backend writes to a local archive (app/.data/docs/) — and a SharePoint/Graph
 * backend can be dropped in later behind the same interface without touching callers.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface DocStorage {
  readonly kind: string;
  /** Store the bytes for an initiative document; returns a locator (path/url). */
  put(code: string, ext: string, bytes: Uint8Array): Promise<string>;
  /** True if already stored (so re-runs skip the download). */
  has(code: string, ext: string): Promise<boolean>;
}

/** Local-filesystem backend (default). Files land in <dir>/{document-key}.{ext}. */
export class LocalDocStorage implements DocStorage {
  readonly kind = "local";
  constructor(private readonly dir: string = resolve(process.cwd(), ".data/docs")) {}

  private path(code: string, ext: string): string {
    const safe = code.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.dir, `${safe}.${ext.replace(/^\./, "")}`);
  }

  async put(code: string, ext: string, bytes: Uint8Array): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const p = this.path(code, ext);
    await writeFile(p, bytes);
    return p;
  }

  async has(code: string, ext: string): Promise<boolean> {
    try {
      await stat(this.path(code, ext));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * SharePoint/Graph backend — placeholder. Wire up with a Microsoft Graph app
 * registration (tenant + client credentials) to PUT into the FerdinandHerrera DataBank
 * drive. Same interface, so `createStorage()` just swaps based on env.
 */
// export class SharePointDocStorage implements DocStorage { ... }

export function createStorage(): DocStorage {
  // if (process.env.SHAREPOINT_SITE_ID && process.env.GRAPH_CLIENT_ID) return new SharePointDocStorage();
  return new LocalDocStorage(process.env.OCULIS_DOCS_DIR);
}
