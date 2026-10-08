/* The bell and answer sounds, made with the browser's own audio (no sound files). Used by the door screen and the control panel.
 * An own sound file is played instead when the settings say "custom". */
(function (root) {
  'use strict';
  const T = {
    classic: { wave: 'sine', notes: [[659.25, 0], [523.25, 0.38]], len: 1 },
    soft: { wave: 'sine', notes: [[392, 0], [523.25, 0.4]], len: 1.1 },
    double: { wave: 'triangle', notes: [[880, 0], [880, 0.22], [659.25, 0.5]], len: 0.5 },
    chime: { wave: 'sine', notes: [[1046.5, 0], [784, 0.3], [659.25, 0.6], [523.25, 0.9]], len: 1.2 },
    digital: { wave: 'square', notes: [[1200, 0], [1200, 0.16], [1200, 0.32]], len: 0.12, vol: 0.12 },
  };
  const NAMES = { classic: 'Klassiek', soft: 'Zacht', double: 'Dubbel', chime: 'Klokkenspel', digital: 'Digitaal', custom: 'Eigen bestand', none: 'Geen geluid' };
  // plays one of the tones on an AudioContext; returns false when there is no such tone
  function play(ctx, name, vol) {
    const t = T[name];
    if (!t) return false;
    const t0 = ctx.currentTime + 0.03;
    for (const [f, dt] of t.notes) {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t0 + dt, v = (t.vol || vol || 0.3);
      o.type = t.wave; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + t.len);
      o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + t.len + 0.05);
    }
    return true;
  }
  root.DoorTones = { play, NAMES, tones: Object.keys(T) };
})(typeof window !== 'undefined' ? window : globalThis);
