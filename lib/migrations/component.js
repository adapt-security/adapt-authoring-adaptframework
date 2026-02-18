import { App } from 'adapt-authoring-core'

async function ComponentTransform (data, importer) {
  if (data._type !== 'component') {
    return
  }
  const mapped = importer.componentNameMap[data._component]
  if (mapped) {
    data._component = mapped
  } else if (!await importer.contentplugin.findOne({ name: data._component }, { validate: false })) {
    throw App.instance.errors.FW_IMPORT_INVALID_CONTENT.setData({ item: data._component })
  }

  if (data._playerOptions === '') {
    delete data._playerOptions
  }
}

export default ComponentTransform
