/**
 * Regression (issue #107, cause 3): probeIntervalMs was dropped at boot.
 *
 * applyConfig() runs before the PeriodicProber is constructed, so its
 * `periodicRef?.setIntervalMs(...)` hit a null ref and silently no-oped;
 * the prober was then constructed with no options and fell back to the
 * hardcoded 10-minute default. A configured cadence only took effect
 * after the next settings save re-ran applyConfig. The fix seeds the
 * configured interval at construction.
 *
 * The prober exposes no interval getter, so these tests observe the one
 * thing that matters — the delay the boot actually hands setInterval.
 * With the free source disabled and no subscriptions, the periodic timer
 * is the only interval created during startIpPool.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { startIpPool } from '../src/ip-pool.ts'

const silent = { info(_m: string) {}, warn(_m: string) {} }

/** Boot the real runtime with setInterval delays recorded; always dispose. */
async function bootDelays(ipPool: Record<string, unknown>): Promise<number[]> {
  const delays: number[] = []
  const real = globalThis.setInterval
  globalThis.setInterval = ((fn: never, ms?: number, ...rest: unknown[]) => {
    delays.push(ms ?? 0)
    return (real as (...a: unknown[]) => ReturnType<typeof setInterval>)(fn, ms, ...rest)
  }) as typeof setInterval
  try {
    const runtime = await startIpPool(
      { ipPool: { enabled: true, manual: ['http://127.0.0.1:7897'], free: { enabled: false }, ...ipPool } } as never,
      silent,
    )
    assert.ok(runtime !== null, 'runtime assembles')
    await runtime.dispose()
  } finally {
    globalThis.setInterval = real
  }
  return delays
}

test('boot: the periodic loop starts on the configured probeIntervalMs', async () => {
  const delays = await bootDelays({ probeIntervalMs: 120_000 })
  assert.ok(delays.includes(120_000), `expected a 120000ms interval, got ${JSON.stringify(delays)}`)
  assert.ok(!delays.includes(600_000), `the 10min default must not survive a configured interval, got ${JSON.stringify(delays)}`)
})

test('boot: without probeIntervalMs the periodic loop keeps the 10min default', async () => {
  const delays = await bootDelays({})
  assert.deepEqual(delays, [600_000])
})
