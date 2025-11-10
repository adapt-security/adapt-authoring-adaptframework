async function StartPage (data, importer) {
  if (data._type !== 'course' || data._start === undefined) {
    return
  }
  let pageIndex = 1
  data._start._startIds.forEach((d, i) => {
    const _id = data._start._startIds[i]._id
    const co = importer.contentJson.contentObjects[_id]
    if (!co) {
      return importer.framework.log('warn', `StartPage transform: unable to find content with _id '${_id}'`)
    }
    co._friendlyId = data._start._startIds[i]._id = co._friendlyId ?? `start_page_${pageIndex++}`
  })
}

export default StartPage
