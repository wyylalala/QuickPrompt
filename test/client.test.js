import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Load the browser half the way the Web page's module loader does, with a stub
 * module table, so the registration contract is checked without a browser.
 */
async function loadClientHalf() {
  const registrations = []
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        registrations.push(entry)
      },
    },
  }
  await import('../client.js')

  const entry = registrations[0]
  assert.ok(entry, 'client.js must call window.__ModuleLoader__.load once')

  const react = {
    createElement() {
      return null
    },
    useState() {
      return [undefined, () => {}]
    },
    useEffect() {},
    useCallback(callback) {
      return callback
    },
  }
  const module = entry.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected import: ${name}`)
  })

  const injected = []
  const registered = []
  const ctx = {
    get() {
      return undefined
    },
    effect(callback) {
      callback()
      return () => {}
    },
    slots: {
      inject(key, callback) {
        injected.push(key)
        callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  return { entry, module, injected, registered }
}

test('the client half registers one plugins.tab entry named after the package', async () => {
  const { entry, module, injected, registered } = await loadClientHalf()

  assert.equal(entry.id, 'dsh-quickprompt', 'the module id must equal the package name')
  assert.deepEqual(module.inject, ['slots'])
  assert.equal(typeof module.apply, 'function')

  assert.deepEqual(injected, ['plugins.tab'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'plugins.tab')
  assert.equal(registered[0].options.id, 'quickprompt')
  assert.equal(registered[0].options.label, '提示词库')
  assert.equal(typeof registered[0].component, 'function', 'the tab needs a component')
})
