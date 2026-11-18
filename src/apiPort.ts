/** The port Ouijit's local API listens on, once the hook server is up; 0 before then. */
let apiPort = 0;

export function getApiPort(): number {
  return apiPort;
}

export function setApiPort(port: number): void {
  apiPort = port;
}
