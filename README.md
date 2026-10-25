# Finance Desk

Schlanke Web-App für **aktuelle Finanznachrichten** und **Kennzahlen zu frei wählbaren Aktien**.
Node.js ohne externe Abhängigkeiten (kein `npm install` nötig).

## Start

```bash
npm start            # http://localhost:3000  (Port via PORT=…)
npm test             # Unit- und API-Tests mit gemockten Datenquellen
```

Voraussetzung: Node.js ≥ 22.

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Nachrichten** | Kategorien *Märkte, Deutschland, Leveraged Finance, Project Finance, M&A / Private Equity, Makro & Zinsen*; Freitextsuche (DE/EN); Deduplizierung, Sortierung nach Zeit, Auto-Refresh alle 5 Min. |
| **Aktien** | Suche mit Autovervollständigung (Name oder Ticker, z. B. `SAP.DE`, `AAPL`), Kurschart (1T bis Max), Kennzahlen, Unternehmensprofil, Unternehmensnachrichten, Watchlist (lokal im Browser) |
| **Peer-Vergleich** | Trading-Comps-Tabelle für die Watchlist mit Median-Zeile, sortierbar |

### Kennzahlen

- **Bewertung:** Market Cap, EV, EV/Umsatz, EV/EBITDA, KGV (TTM/Forward), PEG, P/B, P/S, FCF-Rendite
- **Verschuldung & Liquidität:** Total Debt, Cash, Net Debt, Net Debt/EBITDA, Total Debt/EBITDA, Zinsdeckung (EBIT/Zinsaufwand), Debt/Equity, Current/Quick Ratio
- **Profitabilität (TTM):** Umsatz, EBITDA, Jahresüberschuss, Brutto-/EBITDA-/EBIT-/Nettomarge, RoE, RoA
- **Cashflow & Wachstum:** OCF, FCF, Cash Conversion (FCF/EBITDA), Umsatz-/Gewinnwachstum, EPS
- **Aktie & Dividende:** Dividendenrendite, Payout, Beta, 52W-Range/-Performance, Aktienanzahl, Free Float, Analysten-Kursziel, nächster Berichtstermin

Konventionen: negative Multiples werden als `n. m.` ausgewiesen (nicht im Median); negatives Net Debt/EBITDA als `Net Cash`.
Weichen Handels- und Berichtswährung ab (z. B. ADRs), wird darauf hingewiesen; die FCF-Rendite entfällt dann.

## Datenquellen & Einschränkungen

- **Kurse/Fundamentaldaten:** Yahoo Finance (inoffizielle Endpunkte; Cookie/Crumb wird automatisch bezogen). Daten ggf. verzögert, Abdeckung je Titel unterschiedlich. Ist die Fundamentaldaten-Schnittstelle nicht erreichbar, zeigt die App einen reduzierten Datensatz (Kurs, Handelsdaten) mit Hinweis.
- **Nachrichten:** RSS-Feeds (Yahoo Finance, CNBC, MarketWatch, FT, tagesschau) und Google-News-Suchfeeds.
- Antworten werden serverseitig kurz gecacht (Kurse 2 Min., News 5 Min.).
- Keine Anlageberatung.

## Struktur

```
server.js          HTTP-Server, API-Routen, statische Auslieferung
lib/yahoo.js       Yahoo-Finance-Client (Suche, quoteSummary, Chart, News)
lib/metrics.js     Ableitung der Kennzahlen
lib/news.js        Feed-Konfiguration und Aggregation
lib/rss.js         RSS-/Atom-Parser
public/            Frontend (HTML/CSS/Vanilla JS, SVG-Chart)
test/              node:test-Suite
```

## API

| Endpunkt | Beschreibung |
|---|---|
| `GET /api/news?category=levfin` | Nachrichten einer Kategorie |
| `GET /api/news?q=…&lang=de\|en` | Nachrichtensuche |
| `GET /api/search?q=…` | Wertpapiersuche |
| `GET /api/stock/:symbol` | Kennzahlen |
| `GET /api/stock/:symbol/chart?range=1y` | Kursverlauf (`1d,5d,1mo,6mo,ytd,1y,5y,max`) |
| `GET /api/stock/:symbol/news` | Unternehmensnachrichten |
