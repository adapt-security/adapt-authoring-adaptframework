import { App } from 'adapt-authoring-core'

/** @ignore */ const buildCache = {}

/**
 * Retrieves metadata for a build attempt
 * @param {String} id ID of build document
 * @return {Promise}
 */
export async function retrieveBuildData (id) {
  if (buildCache[id]) {
    return buildCache[id]
  }
  const mdb = await App.instance.waitForModule('mongodb')
  const [data] = await mdb.find('adaptbuilds', { _id: id })
  buildCache[id] = data
  return data
}
