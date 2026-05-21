const parseSectionId = href => {
  if (!href) return null

  const hashIndex = href.indexOf('#')
  const hash = hashIndex >= 0 ? href.slice(hashIndex + 1) : href
  if (!hash) return null

  if (hash.startsWith('/')) {
    const query = hash.split('?')[1] || ''
    return new URLSearchParams(query).get('id')
  }

  return hash.split('?')[0] || null
}

const setActiveLink = (links, id) => {
  links.forEach(item => {
    const isActive = item.id === id
    item.link.classList.toggle('is-active', isActive)

    if (isActive) item.link.setAttribute('aria-current', 'location')
    else item.link.removeAttribute('aria-current')

    const li = item.link.closest('li')
    if (li) li.classList.toggle('is-active', isActive)
  })
}

let teardownSidebarHighlight = () => {}

const setupSidebarHighlight = () => {
  teardownSidebarHighlight()
  teardownSidebarHighlight = () => {}

  const section = document.querySelector('.markdown-section')
  const sidebarNav = document.querySelector('.sidebar .sidebar-nav')
  if (!section || !sidebarNav) return

  const links = [...sidebarNav.querySelectorAll('a[href]')]
    .map(link => ({ id: parseSectionId(link.getAttribute('href')), link }))
    .filter(item => item.id)

  if (links.length === 0) return

  const linkIds = new Set(links.map(item => item.id))
  const headings = [...section.querySelectorAll('h1[id], h2[id], h3[id]')].filter(heading =>
    linkIds.has(heading.id)
  )

  if (headings.length === 0) {
    setActiveLink(links, links[0].id)
    return
  }

  let frame = null

  const sync = () => {
    frame = null

    const threshold = window.scrollY + Math.max(24, window.innerHeight * 0.16)
    let activeId = headings[0].id

    for (const heading of headings) {
      if (heading.offsetTop <= threshold) activeId = heading.id
      else break
    }

    setActiveLink(links, activeId)
  }

  const requestSync = () => {
    if (frame !== null) return
    frame = window.requestAnimationFrame(sync)
  }

  const onClick = event => {
    const link = event.target.closest('a[href]')
    if (!link || !sidebarNav.contains(link)) return

    const id = parseSectionId(link.getAttribute('href'))
    if (id) setActiveLink(links, id)

    if (window.innerWidth <= 900) document.body.classList.remove('close')
  }

  window.addEventListener('scroll', requestSync, { passive: true })
  window.addEventListener('resize', requestSync)
  sidebarNav.addEventListener('click', onClick)

  requestSync()
  window.setTimeout(requestSync, 120)

  teardownSidebarHighlight = () => {
    window.removeEventListener('scroll', requestSync)
    window.removeEventListener('resize', requestSync)
    sidebarNav.removeEventListener('click', onClick)
    if (frame !== null) window.cancelAnimationFrame(frame)
  }
}

const enhancePage = () => {
  const content = document.querySelector('.content')
  const sidebar = document.querySelector('.sidebar')
  const appNameLink = document.querySelector('.app-name-link')
  const seoContent = document.querySelector('#seo-content')

  if (seoContent) seoContent.remove()

  if (content) {
    content.id = 'main-content'
    content.setAttribute('role', 'main')
    content.setAttribute('tabindex', '-1')
  }

  if (sidebar) {
    sidebar.setAttribute('role', 'navigation')
    sidebar.setAttribute('aria-label', 'Primary navigation')
  }

  if (appNameLink) {
    appNameLink.setAttribute('aria-label', 'isolated function home')
  }

  setupSidebarHighlight()
}

window.$docsify = {
  name: 'isolated-function',
  repo: 'Kikobeats/isolated-function',
  logo: './static/logo.png',
  coverpage: true,
  externalLinkRel: 'noopener noreferrer',
  auto2top: true,
  maxLevel: 3,
  subMaxLevel: 2,
  plugins: [
    hook => {
      hook.doneEach(() => {
        enhancePage()
      })
    }
  ]
}
