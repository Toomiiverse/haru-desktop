# Mood timing correction

Haru varies her life-tick interval, but `driftVitals` previously capped every
update at 20 seconds. A 60-second interval therefore advanced her internal state
at one third of the intended rate. This affected energy, sleepiness, stress,
focus, affection and happiness even when the environment was unchanged.

The function now catches up in 20-second steps, with a final partial step. Normal
20-second updates retain their existing calculations. Invalid or backwards elapsed
times leave the state unchanged. Catch-up is bounded to one hour: these rates
already settle in that time, and the latest environment snapshot cannot describe
everything that happened during a long absence.

## Controlled comparison

Start with stress 0.9 and happiness 0.2, hold an active, focused midday environment
constant, and simulate ten minutes:

| Tick interval | Old final stress | Corrected final stress | Old final happiness | Corrected final happiness |
|---|---:|---:|---:|---:|
| 20 seconds | 0.2618 | 0.2618 | 0.8237 | 0.8237 |
| 60 seconds | 0.4210 | 0.2618 | 0.5990 | 0.8237 |
| 300 seconds | 0.7477 | 0.2618 | 0.2980 | 0.8237 |

Three new regression tests first failed against the old code, then passed with
the correction: elapsed-time catch-up in daytime and sleep conditions; invalid
clocks; and bounded work for an extreme finite jump. All 1,123 local tests passed.
The nominal 20-second attention comparison is unchanged.

This is a timing fix in Haru's existing homeostatic system. It uses no downloaded
brain data and does not establish that different numerical moods feel better to
the user. Sub-20-second partitions still have the small approximation differences
of the original integration method.

Reproduce the controlled trace after `npm test`:

    node research/fruitfly/vitals-timing.cjs output.json
