async function ThemeUndef (data, importer) {
  if (data._type !== 'config' || data._theme !== undefined) {
    return
  }
  data._theme = Object.values(importer.usedContentPlugins).find(p => p.type === 'theme')?.name
}

export default ThemeUndef
