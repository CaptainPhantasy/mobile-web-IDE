// Client library for the server-side API-key vault. The client never
// sees the stored key values — only which provider IDs have a key set.
// All actual use of the key happens server-side (the LLM proxy reads
// from the vault by provider.id).

export async function listVaultIds(): Promise<string[]> {
  try {
    const r = await fetch('/api/vault/list');
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.ids) ? d.ids : [];
  } catch {
    return [];
  }
}

export async function setVaultKey(id: string, key: string): Promise<boolean> {
  try {
    const r = await fetch('/api/vault/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, key }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteVaultKey(id: string): Promise<boolean> {
  try {
    const r = await fetch('/api/vault/delete?id=' + encodeURIComponent(id), {
      method: 'DELETE',
    });
    return r.ok;
  } catch {
    return false;
  }
}
