import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createErrorCapturingLogger } from '../lib/utils/createErrorCapturingLogger.js'

function makeSpyLogger () {
  const calls = { info: [], warn: [], debug: [], log: [], error: [] }
  return {
    calls,
    info: (...args) => calls.info.push(args),
    warn: (...args) => calls.warn.push(args),
    debug: (...args) => calls.debug.push(args),
    log: (...args) => calls.log.push(args),
    error: (...args) => calls.error.push(args)
  }
}

describe('createErrorCapturingLogger()', () => {
  it('should start with no captured errors', () => {
    const capturing = createErrorCapturingLogger(makeSpyLogger())
    assert.deepEqual(capturing.errors, [])
  })

  it('should forward all log levels to the wrapped logger', () => {
    const spy = makeSpyLogger()
    const capturing = createErrorCapturingLogger(spy)
    capturing.info('i')
    capturing.warn('w')
    capturing.debug('d')
    capturing.log('info', ['l'])
    capturing.error('e')
    assert.deepEqual(spy.calls.info, [['i']])
    assert.deepEqual(spy.calls.warn, [['w']])
    assert.deepEqual(spy.calls.debug, [['d']])
    assert.deepEqual(spy.calls.log, [['info', ['l']]])
    assert.deepEqual(spy.calls.error, [['e']])
  })

  it('should capture error-level messages but not other levels', () => {
    const capturing = createErrorCapturingLogger(makeSpyLogger())
    capturing.info('all good')
    capturing.warn('careful')
    capturing.error('Task -- shouldContinue errored boom')
    assert.equal(capturing.errors.length, 1)
    assert.match(capturing.errors[0], /shouldContinue errored boom/)
  })

  it('should join multiple error arguments into one entry', () => {
    const capturing = createErrorCapturingLogger(makeSpyLogger())
    capturing.error('migration', 'failed', 42)
    assert.deepEqual(capturing.errors, ['migration failed 42'])
  })

  it('should record an Error stack when passed an Error instance', () => {
    const capturing = createErrorCapturingLogger(makeSpyLogger())
    const err = new Error('kaboom')
    capturing.error(err)
    assert.match(capturing.errors[0], /kaboom/)
  })

  it('should tolerate a logger missing optional methods', () => {
    const capturing = createErrorCapturingLogger({})
    assert.doesNotThrow(() => {
      capturing.info('i')
      capturing.error('e')
    })
    assert.equal(capturing.errors.length, 1)
  })
})
