# Ukeshandel (v0)

Ukeplan for middager + handleliste for én husstand. Ren statisk side (HTML/CSS/JS), ingen byggesteg, ingen backend, ingen eksterne avhengigheter. Data lagres i nettleseren (`localStorage`, nøkkel `ukeshandel:v1`).

## Kjøre lokalt

```sh
cd app
python3 -m http.server 8000
# åpne http://localhost:8000
```

Kan hostes som vanlige statiske filer (hvilken som helst HTTPS-statisk hosting). `index.html` er inngangen.

## Sider
- **Retter** – legg til / rediger / slett retter (navn, minutter, ingredienser, merknad). «Tilbakestill testdata» nederst.
- **Uke** – man–søn for valgt uke, velg rett eller «Tom». Samme rett kan ikke brukes to ganger i samme uke. Pilene bytter uke.
- **Liste** – generert fra ukas middager + faste husvarer. Like varer (samme navn + enhet) summeres, gruppert Frukt/grønt → Kjøl → Frys → Tørrvare → Hus. Avkryssing lagres. «Kopier som tekst» kopierer ukryssede varer. Faste husvarer redigeres nederst på Liste.

## Filer
- `index.html` – skall og bunnmeny
- `style.css` – stil (mobil først)
- `app.js` – logikk, lagring, visning
- `seed.js` – testdata (12 retter, 8 faste husvarer)
- `tests/` – Playwright-skript brukt til testing (krever `npm i playwright-core` og en Chrome/Chromium; forventer server på port 8765)
