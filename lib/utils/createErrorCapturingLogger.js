/**
 * Wraps an adapt-migrations logger so that error-level messages are recorded
 * as well as forwarded.
 *
 * adapt-migrations swallows failed migration steps: a throwing step is caught
 * in `Task.run`, logged via `logger.error('Task -- shouldContinue errored …')`,
 * the journal is rolled back, and `migrate()` resolves as if nothing went
 * wrong (`Task.runApplicable` breaks without re-throwing). The error-level log
 * on the supplied logger is therefore the only signal a step failed. Capturing
 * it lets callers detect the failure and abort.
 *
 * Remove once adapt-migrations propagates the error itself — see
 * https://github.com/adaptlearning/adapt-migrations/issues (tracked downstream
 * in adapt-security/adapt-authoring-adaptframework).
 * @param {Object} logger The adapt-migrations logger to wrap (info/warn/error/debug/log)
 * @returns {Object} A logger that forwards all calls and exposes a captured `errors` array
 */
export function createErrorCapturingLogger (logger) {
  const errors = []
  return {
    errors,
    info: (...args) => logger.info?.(...args),
    warn: (...args) => logger.warn?.(...args),
    debug: (...args) => logger.debug?.(...args),
    log: (...args) => logger.log?.(...args),
    error: (...args) => {
      errors.push(args.map(arg => (arg instanceof Error ? arg.stack ?? arg.message : String(arg))).join(' '))
      return logger.error?.(...args)
    }
  }
}
