// The client's mission clock (app/public/js/mission-clock.js): it advances crc-sync's last `game-time` in real time,
// except while crc-sync says the mission is paused (MISSION_HELD, docs/adr/0129): a paused game clock does not move.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const clock = await import('../app/public/js/mission-clock.js');

test('MISSION advances in real time; MISSION_HELD stays where crc-sync held it; the unpause runs again', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 17, 10, 0, 0) });
  const z = Date.UTC(2016, 5, 21, 1, 40, 0);
  clock.updateGameTime({ zuluMs: z, source: 'MISSION' });
  t.mock.timers.tick(3000);
  assert.equal(clock.missionNow(), z + 3000);
  clock.updateGameTime({ zuluMs: z + 12000, source: 'MISSION_HELD' });
  t.mock.timers.tick(9 * 60000);
  assert.equal(clock.missionNow(), z + 12000);
  assert.equal(clock.missionClockSource(), 'MISSION_HELD');
  clock.updateGameTime({ zuluMs: z + 1000, source: 'MISSION' });
  t.mock.timers.tick(2000);
  assert.equal(clock.missionNow(), z + 3000);
});
