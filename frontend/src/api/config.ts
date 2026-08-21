export interface ProfileCred {
  slug: string
  token: string
  label?: string
}

const PROFILES_KEY = 'srr2_profiles'
const ACTIVE_KEY = 'srr2_active_profile'

export const profileApi = {
  list(): ProfileCred[] {
    try {
      const raw = localStorage.getItem(PROFILES_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  },

  save(list: ProfileCred[]) {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list))
  },

  activeSlug(): string | null {
    return localStorage.getItem(ACTIVE_KEY)
  },

  setActiveSlug(slug: string | null) {
    if (slug) {
      localStorage.setItem(ACTIVE_KEY, slug)
    } else {
      localStorage.removeItem(ACTIVE_KEY)
    }
  },

  active(): ProfileCred | null {
    const slug = this.activeSlug()
    if (!slug) return null
    return this.list().find((p) => p.slug === slug) || null
  },

  add(cred: ProfileCred) {
    const list = this.list().filter((p) => p.slug !== cred.slug)
    list.push(cred)
    this.save(list)
  },

  remove(slug: string) {
    this.save(this.list().filter((p) => p.slug !== slug))
    if (this.activeSlug() === slug) {
      this.setActiveSlug(null)
    }
  },

  generateToken(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return 'srr-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  },
}