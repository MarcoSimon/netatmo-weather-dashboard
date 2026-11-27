/** Timestamped, one-line log records. The poll log is the evidence phase 0 produces. */

function stamp() {
  return new Date().toISOString();
}

function write(stream, level, message) {
  stream.write(`${stamp()} ${level} ${message}\n`);
}

export const log = {
  info: (message) => write(process.stdout, 'INFO ', message),
  warn: (message) => write(process.stderr, 'WARN ', message),
  error: (message) => write(process.stderr, 'ERROR', message),
};
