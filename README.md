# Aestio Web Compliance — Scanner

Self-Service Web-App für den auf der Landingpage beworbenen "kostenlosen
Erstcheck": Beliebige URL eingeben, automatisierter technischer
Compliance-Scan läuft — ohne manuelle Vorkonfiguration pro Website (im
Unterschied zum `aestio-monitoring`-Tool im Nachbarordner, das für den
laufenden Mehrkunden-Betrieb mit Baseline-Vergleich gedacht ist).

**Wichtig:** Dies ist ein technisches Werkzeug, das regelbasiert Befunde
liefert — keine juristische Bewertung. Automatisierte Barrierefreiheits-Scans
decken erfahrungsgemäß nur ca. 30–40 % aller WCAG-Kriterien ab.

## Geprüfte Bereiche

1. **Cookies & Tracking** — externe Requests vor jeglicher Consent-Entscheidung,
   automatische Erkennung gängiger Cookie-Banner (Cookiebot, Usercentrics,
   OneTrust, Borlabs, Complianz, consentmanager, Cookie-Script, Termly, Klaro,
   iubenda, plus Text-Heuristik als Fallback) und ob "Ablehnen" tatsächlich
   weitere externe Requests blockiert.
2. **Barrierefreiheit** — automatisierter WCAG 2.1 A/AA Scan via axe-core.
3. **Rechtstexte** — technische Prüfung, ob Impressum und
   Datenschutzerklärung verlinkt auffindbar sind (keine Inhaltsprüfung).
4. **TLS & Security-Header** — HTTPS-Erzwingung, Zertifikatsgültigkeit,
   sicherheitsrelevante HTTP-Header (HSTS, CSP, X-Frame-Options, ...).
5. **KI-Transparenz** — Erkennung bekannter Chatbot-/Assistenten-Widgets
   (Intercom, Drift, Tidio, Crisp, HubSpot, Zendesk u.a.) und Text-Heuristik,
   ob im Seitentext ein KI-Hinweis auffindbar ist (Transparenzpflicht nach
   Art. 50 Abs. 1 EU AI Act, seit 2. August 2026 durchsetzbar).

Jeder Bereich bekommt eine Ampel (grün/gelb/rot), daraus ergibt sich ein
Gesamtstatus (schlechtester Einzelwert zählt).

## Öffentliche Ansicht vs. Admin-Bereich

Die Person, die den Scan startet, sieht **nur** die Ampel je Bereich und die
Anzahl der Befunde (z. B. "3 Befunde" bei Barrierefreiheit) — keine
Domain-Namen, keine Regel-Details, keine Header-Namen, keine URLs.

Der **vollständige** technische Bericht wird serverseitig unter `reports/`
gespeichert und ist nur über den Admin-Bereich einsehbar:

```
http://localhost:3000/admin?token=<ADMIN_TOKEN>
```

Das Token wird beim ersten Start automatisch generiert, in `admin-token.txt`
(nicht ins Git-Repo aufnehmen) gespeichert und bei jedem Serverstart in der
Konsole ausgegeben — dort den kompletten Link zum Kopieren finden.

## Voraussetzungen

- Node.js ab Version 18 ([nodejs.org](https://nodejs.org))

## Installation

```bash
cd "aestio-scanner"
npm install
npm run install-browsers   # lädt den Chromium-Browser für Playwright herunter
```

## Starten

```bash
npm start
```

Danach im Browser öffnen: **http://localhost:3000**

URL eingeben und auf "Jetzt scannen" klicken. Ein Scan dauert je nach
Zielseite ca. 10–30 Sekunden.

## Sicherheitsvorkehrungen

- Nur `http://` / `https://` Ziele, keine privaten/internen Adressen
  (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, Loopback/Link-Local
  auch für IPv6) — verhindert Missbrauch als Proxy in interne Netzwerke (SSRF).
- Einfaches Rate-Limiting (max. 5 Scans / 10 Minuten pro IP) und eine
  Begrenzung gleichzeitiger Scans, da jeder Scan einen echten Browser startet.

## Bekannte Grenzen

- Cookie-Banner-Erkennung basiert auf bekannten CMP-Selektoren plus einer
  Text-Heuristik ("Ablehnen", "Reject all", …). Exotische/individuell gebaute
  Banner werden ggf. nicht erkannt — dann liefert der Scanner nur die
  Vor-Consent-Tracker-Analyse, aber keine Aussage zur Ablehnen-Funktion.
  Für laufendes Monitoring mit garantiertem Banner-Test bei bekannten Kunden
  weiterhin `aestio-monitoring` mit manuellem Selektor nutzen.
- Rechtstexte-Check prüft nur Auffindbarkeit der Links auf der Startseite,
  keine inhaltliche Vollständigkeit.
- Scan läuft nur gegen die Startseite der eingegebenen URL, kein
  Mehrseiten-Crawling.
- KI-Transparenz-Check erkennt nur bekannte Chatbot-Anbieter über deren
  Domains sowie eine Text-Heuristik für die KI-Kennzeichnung. Individuell
  gebaute Chat-Widgets oder unübliche Formulierungen werden ggf. nicht
  erkannt. Kein Nachweis über tatsächlich eingesetzte KI-Modelle, kein
  Erkennen von KI-generierten Inhalten/Deepfakes.

## Rechtlicher Hinweis zur Nutzung

Die generierten Befunde sind bewusst so formuliert, dass sie technische
Sachverhalte beschreiben, keine rechtliche Bewertung. Bitte bei der Weitergabe
an Kunden nichts umformulieren, das den Eindruck einer rechtlichen Einschätzung
erweckt (z. B. "verstößt gegen DSGVO" statt "externer Request vor Consent
festgestellt").
