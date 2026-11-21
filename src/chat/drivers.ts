import { createDrivers, type AgentDriver } from '../agents';
import type { ChatAgentId } from './model';
import { getOuijitDir, getWrapperBinDir } from '../paths';

const DRIVERS = createDrivers({
  name: 'ouijit',
  title: 'Ouijit',
  instructionsTag: 'ouijit-cli-reference',
  wrapperBinDir: getWrapperBinDir,
  dataDir: getOuijitDir,
});

export function getDriver(id: ChatAgentId): AgentDriver {
  return DRIVERS[id];
}
