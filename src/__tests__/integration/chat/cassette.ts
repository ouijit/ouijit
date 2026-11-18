import * as path from 'node:path';
import * as store from '../../../chat/cassette';

export type { Cassette, CassetteEntry } from '../../../chat/cassetteFormat';
export { replayingSpawn } from '../../../chat/cassette';

const CASSETTE_DIR = path.join(__dirname, 'cassettes');

export const recording = process.env.RECORD_CASSETTES === '1';

export const cassettePath = (name: string) => store.cassettePath(CASSETTE_DIR, name);
export const loadCassette = (name: string) => store.loadCassette(CASSETTE_DIR, name);
export const loadCassettes = (name: string) => store.loadCassettes(CASSETTE_DIR, name);
export const recordingSpawn = (name: string, agent: string, version: string | undefined) =>
  store.recordingSpawn(CASSETTE_DIR, name, agent, version);
