/**
 * Eine Fehlerseite (HTTP >= 400, z. B. 403/429 durch Bot-Schutz) darf nicht wie die
 * echte Seite ausgewertet werden: sonst entstehen Befunde ("Impressum fehlt") oder
 * Entwarnungen ("keine Probleme") auf Basis einer Blockier-/Fehlerseite.
 * Wirft einen Error, der in den bestehenden Fehlerpfaden der Checks landet.
 */
export function assertUsableResponse(response) {
  const status = typeof response?.status === 'function' ? response.status() : null;
  if (typeof status === 'number' && status >= 400) {
    throw new Error(`Seite lieferte HTTP ${status}`);
  }
}
