/**
 * Infers the framework action to be executed from a given request URL
 * @param {external:ExpressRequest} req
 * @return {String}
 */
export function inferBuildAction (req) {
  const end = req.url.indexOf('/', 1)
  return req.url.slice(1, end === -1 ? undefined : end)
}
