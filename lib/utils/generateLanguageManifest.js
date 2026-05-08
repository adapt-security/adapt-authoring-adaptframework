/**
 * Returns the list of JSON filenames that belong in a language manifest.
 * The framework runtime reads this to know which data files to fetch.
 * @param {Array<String>} jsonFileNames All JSON filenames written to the language dir
 * @return {Array<String>} Filtered list excluding the manifest itself and assets.json
 */
export function generateLanguageManifest (jsonFileNames) {
  return jsonFileNames.filter(f => f !== 'language_data_manifest.js' && f !== 'assets.json')
}
