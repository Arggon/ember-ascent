// Deprecated path — the effect vocabulary lives in ./vocabulary.js.
// This shim exists only so the earlier filename keeps resolving to the single
// implementation; it must never hold logic of its own (the architecture gate
// reports it as a re-export, not a second definition).
export * from './vocabulary.js';
