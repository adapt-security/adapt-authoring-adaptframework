import { App } from 'adapt-authoring-core'

/**
 * Returns a 'slugified' version of the course title appropriate for a filename
 * @param {Object} buildData The course build data
 * @returns {string} The slugified title
 */
export async function slugifyTitle (buildData) {
  const content = await App.instance.waitForModule('content')
  const [course] = await content.find({ _id: buildData.courseId })
  const sanitisedTitle = course.title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 -]/g, '') // remove non-alphanumeric
    .replace(/\s+/g, '-') // replace spaces with hyphens
    .replace(/-+/g, '-') // remove duplicate hyphens
  return `${sanitisedTitle}${buildData.action === 'export' ? '-export' : ''}`
}
