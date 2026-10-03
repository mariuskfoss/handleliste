# Knaggen

*Husets felles huskeliste.*

Ukeplan for middager og handleliste, delt i husstanden. Statisk nettside (HTML/CSS/JS) uten byggesteg.

## Slik virker den
- **Uke** – velg middag for hver dag, eller la «Fyll man–fre» foreslå raske retter. Dager kan byttes, og endringer kan angres.
- **Liste** – handlelista lages av ukas middager, faste varer og det du legger til selv. Like varer slås sammen og rundes opp til hele pakninger, gruppert etter avdeling i butikken.
- **Retter** – egne retter og forslag fra et bibliotek med norske hverdagsretter.
- **Del med husstanden** – valgfritt. En delingslenke gjør at flere telefoner ser samme uke og liste (ingen konto).

Uten deling lagres alt bare i nettleseren på telefonen. Appen virker også uten nett (service worker).

## Kjøre lokalt

```sh
python3 -m http.server 8000
# åpne http://localhost:8000
```

`index.html` er inngangen. Siden kan ligge på hvilken som helst statisk HTTPS-hosting.

## Filer
- `index.html` – skall, bunnmeny og metadata
- `manifest.webmanifest`, `icons/` – navn og ikoner for hjemskjerm og nettleser
- `style.css` – utseende (lys og mørk modus)
- `app.js` – logikk og visning
- `units.js` – enheter og pakningsstørrelser på handlelista
- `seed.js`, `library.js` – startdata og rettbibliotek
- `sync.js`, `firebase-config.js` – deling i husstanden
- `sw.js` – frakoblet bruk
