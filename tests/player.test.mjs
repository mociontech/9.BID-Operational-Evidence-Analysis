import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player.js';
import { formatTime } from '../src/protocol.js';

class Media extends EventTarget {
  currentTime = 0; duration = 120; paused = true; readyState = 4;
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
const setup = async () => {
  const media = new Media(); const player = new Player(media, () => {}); await player.arm();
  let id = 0;
  const send = async (action, value) => {
    await player.command({ ...player.snapshot(), id: String(++id), action, value });
    if (action === 'start') await player.command({ ...player.snapshot(), id: String(++id), action: 'intro-complete' });
  };
  return { media, player, send };
};
test('start, pause, reboot and back implement the agreed lifecycle', async () => {
  const { media, player, send } = await setup();
  assert.equal(player.mode, 'home'); assert.equal(media.paused, true);
  await send('start'); assert.equal(player.mode, 'video'); assert.equal(media.paused, false);
  await send('seek', 45); await send('pause'); assert.equal(media.currentTime, 45); assert.equal(media.paused, true);
  await send('reboot'); assert.equal(media.currentTime, 0); assert.equal(media.paused, false);
  await send('back'); assert.equal(player.mode, 'home'); assert.equal(media.currentTime, 0); assert.equal(media.paused, true);
});
test('skip clamps at zero, preserves pause, and reaching the end returns home', async () => {
  const { media, player, send } = await setup();
  await send('start'); await send('pause'); await send('skip', -10);
  assert.equal(media.currentTime, 0); assert.equal(media.paused, true);
  await send('skip', 10); assert.equal(media.currentTime, 10);
  await send('seek', 118); await send('skip', 10);
  assert.equal(player.mode, 'home'); assert.equal(media.currentTime, 0);
});
test('native ended returns to home', async () => {
  const { media, player, send } = await setup();
  await send('start'); media.currentTime = 120; media.dispatchEvent(new Event('ended'));
  assert.equal(player.snapshot().mode, 'home'); assert.equal(media.paused, true);
});
test('duplicate, stale-run, expired snapshot and invalid commands are ignored', async () => {
  const { media, player, send } = await setup(); await send('start');
  await send('seek', 0);
  const command = { ...player.snapshot(), id: 'duplicate', action: 'skip', value: 10 };
  await player.command(command); await player.command(command); assert.equal(media.currentTime, 10);
  await player.command({ ...player.snapshot(), id: 'invalid', action: 'seek', value: NaN }); assert.equal(media.currentTime, 10);
  await player.command({ ...player.snapshot(), id: 'old', snapshot: 'expired', action: 'back' }); assert.equal(player.mode, 'video');
  await send('back'); await player.command({ ...command, id: 'old-run', action: 'start' }); assert.equal(player.mode, 'home');
});
test('play rejection is reported and returns to home', async () => {
  const { media, player, send } = await setup(); media.play = async () => { throw new Error('Blocked'); };
  await send('start'); assert.equal(player.ready, false); assert.equal(player.mode, 'home'); assert.ok(player.error);
});
test('time formatting handles minutes and missing metadata', () => {
  assert.equal(formatTime(125.9), '2:05'); assert.equal(formatTime(NaN), '0:00');
});

test('intro holds a nonzero frame until confirmation and Back cancels it', async () => {
  const { media, player } = await setup();
  const send = (id, action) => player.command({ ...player.snapshot(), id, action });
  await send('start-1', 'start');
  assert.equal(player.intro, true); assert.equal(media.paused, true); assert.equal(media.currentTime, 1);
  await send('early-play', 'play'); await send('early-reboot', 'reboot');
  assert.equal(media.paused, true); assert.equal(media.currentTime, 1);
  await send('done-1', 'intro-complete');
  assert.equal(player.intro, false); assert.equal(media.paused, false); assert.equal(media.currentTime, 1);
  await send('back-1', 'back'); await send('start-2', 'start');
  const staleDone = { ...player.snapshot(), id: 'stale-done', action: 'intro-complete' };
  await send('back-2', 'back'); await player.command(staleDone);
  assert.equal(player.mode, 'home'); assert.equal(media.paused, true);
});
