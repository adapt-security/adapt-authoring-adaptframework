async function ConfigTransform (data) {
  if (data._type !== 'course') {
    return
  }
  const exts = data._globals._extensions
  Object.keys(exts).forEach(k => {
    if(exts[k]._navOrder !== undefined)
      exts[k]._navOrder = Number(exts[k]._navOrder)
  })
}

export default ConfigTransform
