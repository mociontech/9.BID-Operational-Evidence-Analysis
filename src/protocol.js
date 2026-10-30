export const clamp = (value, duration) => Math.min(Math.max(0, value), Math.max(0, duration || 0));
export const uniqueId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
export const formatTime = (value) => {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// Commands are tied to the last screen snapshot, never to either device's clock.
export function accepts(command, state, seen, recentSnapshots) {
  return command && typeof command.id === 'string' && !seen.has(command.id)
    && command.boot === state.boot && command.run === state.run
    && recentSnapshots.has(command.snapshot)
    && ['start', 'intro-complete', 'reboot', 'back', 'play', 'pause', 'skip', 'seek'].includes(command.action)
    && (!['skip', 'seek'].includes(command.action) || Number.isFinite(command.value));
}
