# Vlastní zvuky

Všechny zvuky hra syntetizuje procedurálně (Web Audio). Pokud sem vložíš soubor
`<název>.ogg` (případně `.mp3` / `.wav`), použije se místo syntézy.

Jednorázové zvuky: `meow`, `meowAsk`, `meowAnnoyed`, `purr`, `step`, `land`, `jump`, `scratch`,
`swipe`, `click`, `lockClick`, `lockOpen`, `beep`, `paper`, `glass`, `thud`, `clank`, `doorLock`,
`doorCreak`, `crunch`, `chime`, `whoosh`, `bump`, `bag`, `tick`.

Smyčky: `fridge`, `draft`, `vacuum`, `city`, `purrLoop`.

Seznam souborů se načítá při startu dev serveru / při buildu – po přidání souboru stačí
obnovit stránku (dev) nebo znovu spustit `npm run build`.
