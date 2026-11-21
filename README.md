# gta6-trophy-rarity-forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/{owner}/{repo}/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/{owner}/{repo}/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

A forecaster for Grand Theft Auto VI's PlayStation 5 trophy earn rates on Exophase. Given a case holding the house's reads of the trophy page up to a checkpoint, it writes five quantiles (5%, 25%, 50%, 75%, 95%) of every trophy's earn rate at the case's target: a median curve fitted on the logit scale against log time, extrapolated with the slope damped, and a band that grows with the horizon and the fit's own residual.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

It reads every `*.in` case in the input directory (name order) and writes one `<id>.out` per case: `{"trophies": [{"id": n, "q": [q05, q25, q50, q75, q95]}]}`.

## How the forecast is made

- Each trophy's reads are deduplicated to the ones where its rate actually moved: Exophase refreshes its counts on its own clock, so most reads repeat the page before them.
- A rate is mapped to the logit scale, and the house's reads are fitted as a straight line against log time (`ln(1 + hours/12)`), so the launch-night rush and the slow tail share one axis.
- The line is read at the target with its slope damped (0.6): trophy rates saturate, and a full slope carried 4.5 days past the data overshoots.
- A trophy with a thin series borrows its tier's median slope, and one with fewer than three moves falls back to that tier's slope alone: no trophy swings the forecast on three points.
- The band around the median combines the fit's own residual, a random-walk term over the horizon (0.42 standard deviations per square root of day), and the extra the extrapolation itself adds. Quantiles are the normal's at 5/25/50/75/95% of that band, pushed back through the logistic curve and clamped to 0.01–99.99.
- Two runs on one case write the same bytes: there is no randomness and no clock in the program.

## Files

- `main.ts` — the program: reads `$MAKEFUN_INPUT_DIR` (else `/input`), writes `$MAKEFUN_OUTPUT_DIR` (else `/output`); Node 22, standard library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
