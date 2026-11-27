import log from 'electron-log/main';
import { formatLogEntry } from './logger';

// electron-log runs more transforms after this one that expect an array, and a
// bare string returned here gets spread into one argument per character.
log.transports.file.format = ({ data, level, message }) => [formatLogEntry(data, level, message.scope)];

log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.fileName = 'ouijit.log';

log.errorHandler.startCatching();

export default log;
