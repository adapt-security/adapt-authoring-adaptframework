async function StartPage (data, importer) {
  if (data._type !== 'course' || data._start === undefined) {
    return
  }
  const pages = Object.values(importer.contentJson.contentObjects).filter(c => c._type === 'page')
  let pageIndex = 1
  for (let i = 0; i < data._start._startIds.length; i++) {
    const _id = data._start._startIds[i]._id
    let co = importer.contentJson.contentObjects[_id]
    if (!co) {
      // A start id referencing content missing from the import would leave the
      // course unable to route to its start page (the player loads indefinitely).
      if (pages.length === 1) {
        // Single-page course: fall back to that page.
        co = pages[0]
        importer.framework.log('warn', `StartPage transform: unable to find content with _id '${_id}'; defaulting to the course's only page '${co._id}'`)
      } else {
        // Can't safely choose a start page: remove the start config so the menu loads.
        importer.framework.log('warn', `StartPage transform: unable to find content with _id '${_id}'; removing _start config so the menu is loaded`)
        delete data._start
        return
      }
    }
    co._friendlyId = data._start._startIds[i]._id = co._friendlyId ?? `start_page_${pageIndex++}`
  }
}

export default StartPage
