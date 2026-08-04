export interface Clock {
  now(): number;
}

export const RealClock: Clock = {
  now: () => Date.now(),
};
