const FIELDS = ['_backgroundRepeat', '_backgroundSize', '_backgroundPosition']

function clean (styles) {
  if (!styles || typeof styles !== 'object') return
  for (const f of FIELDS) {
    if (styles[f] === '' || styles[f] === null) delete styles[f]
  }
}

async function VanillaBackgroundStyles (data) {
  const v = data._vanilla
  if (!v || typeof v !== 'object') return
  clean(v._backgroundStyles)
  clean(v._pageHeader?._backgroundStyles)
}

export default VanillaBackgroundStyles
