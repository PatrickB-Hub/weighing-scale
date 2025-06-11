export type JiggleState = { amplitude: number; phase: number };

export function updateJiggle(
  state: JiggleState,
  dt: number,
  velocityChange: number,
  angularSpeed: number,
  contactImpulse: number,
  reducedMotion: boolean,
) {
  const decayed = state.amplitude * Math.exp(-dt * 5);
  const excitation =
    Math.min(velocityChange, 0.8) * 0.018 +
    Math.min(angularSpeed, 8) * dt * 0.004 +
    Math.min(contactImpulse, 0.1) * 0.3;
  state.amplitude = reducedMotion ? 0 : Math.min(0.075, decayed + excitation);
  state.phase += dt * 21;
  const wave = Math.sin(state.phase) * state.amplitude;
  return {
    x: 1 + wave * 0.65,
    y: 1 - wave,
    z: 1 + wave * 0.4,
    tilt: Math.sin(state.phase * 0.8) * state.amplitude * 0.32,
  };
}
