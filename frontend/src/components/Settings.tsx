import { useEffect, useState } from 'react'
import { PlugZap, Save, X } from 'lucide-react'
import {
  apiConfigDefaults,
  apiCreateProfile,
  apiDeleteProfile,
  apiErrorMessage,
  apiGetProfile,
  apiTestConfig,
  apiUpdateProfile,
} from '../api/client'
import { profileApi, type ProfileCred } from '../api/config'

interface SettingsProps {
  onProfilesChanged: () => void
  onSelectProfile: (slug: string) => void
}

interface FormState {
  slug: string
  jira_cloud_url: string
  jira_email: string
  jira_api_token: string
  jira_projects: string
  llm_provider: string
  llm_model: string
  llm_api_key: string
  story_points_field: string
}

const EMPTY_FORM: FormState = {
  slug: '',
  jira_cloud_url: '',
  jira_email: '',
  jira_api_token: '',
  jira_projects: '',
  llm_provider: 'gemini',
  llm_model: '',
  llm_api_key: '',
  story_points_field: '',
}

export default function Settings({ onProfilesChanged, onSelectProfile }: SettingsProps) {
  const [profiles, setProfiles] = useState<ProfileCred[]>(() => profileApi.list())
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [accessToken, setAccessToken] = useState('')
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ status: string; text: string } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    apiConfigDefaults()
      .then((d) => {
        setDefaultModels(d.default_models)
        setForm((f) => ({
          ...f,
          llm_model: f.llm_model || d.default_models[f.llm_provider] || '',
        }))
      })
      .catch(() => {})
  }, [])

  // Prefill the form with the last saved (active) profile's settings on load.
  useEffect(() => {
    const active = profileApi.active()
    if (active) startEdit(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshProfiles = () => {
    const list = profileApi.list()
    setProfiles(list)
    onProfilesChanged()
  }

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const switchProvider = (provider: string) => {
    setForm((f) => ({
      ...f,
      llm_provider: provider,
      llm_model: defaultModels[provider] || '',
    }))
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await apiTestConfig({
        jira_cloud_url: form.jira_cloud_url,
        jira_email: form.jira_email,
        jira_api_token: form.jira_api_token,
        jira_projects: form.jira_projects,
        llm_provider: form.llm_provider,
        llm_model: form.llm_model,
        llm_api_key: form.llm_api_key,
        story_points_field: form.story_points_field,
      })
      const r = response.result
      const lines: string[] = []
      lines.push(`Auth: ${r.auth?.ok ? '✅ ok' : `❌ ${r.auth?.error || 'failed'}`}`)
      lines.push(`Story Points field: ${r.story_points_field?.ok ? '✅ detected' : `❌ ${r.story_points_field?.error || 'not detected'}`}`)
      for (const [key, p] of Object.entries(r.projects || {})) {
        lines.push(`Project ${key}: ${p.ok ? `✅ ${p.active_sprint || 'ok'}` : `❌ ${p.error || 'failed'}`}`)
      }
      lines.push(`LLM ${r.llm?.provider} / ${r.llm?.model}: ${r.llm?.ok ? '✅ ok' : `⚠️ ${r.llm?.error || 'skipped'}`}`)
      setTestResult({ status: response.status, text: lines.join('\n') })
    } catch (error) {
      setTestResult({ status: 'error', text: apiErrorMessage(error) })
    } finally {
      setTesting(false)
    }
  }

  const saveProfile = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const token = accessToken || profileApi.generateToken()
      if (editingSlug) {
        const body: Record<string, unknown> = {
          jira_cloud_url: form.jira_cloud_url,
          jira_email: form.jira_email,
          jira_api_token: form.jira_api_token,
          jira_projects: form.jira_projects,
          llm_provider: form.llm_provider,
          llm_model: form.llm_model,
          llm_api_key: form.llm_api_key,
          story_points_field: form.story_points_field,
        }
        if (accessToken) body.access_token = accessToken
        await apiUpdateProfile(editingSlug, body)
        setMessage({ kind: 'ok', text: `Profile '${editingSlug}' updated.` })
      } else {
        const response = await apiCreateProfile({
          slug: form.slug,
          access_token: token,
          jira_cloud_url: form.jira_cloud_url,
          jira_email: form.jira_email,
          jira_api_token: form.jira_api_token,
          jira_projects: form.jira_projects,
          llm_provider: form.llm_provider,
          llm_model: form.llm_model,
          llm_api_key: form.llm_api_key,
          story_points_field: form.story_points_field,
        })
        profileApi.add({ slug: form.slug, token: response.access_token })
        profileApi.setActiveSlug(form.slug)
        onSelectProfile(form.slug)
        setMessage({ kind: 'ok', text: `Profile '${form.slug}' created and activated. Access token saved in this browser.` })
      }
      setAccessToken('')
      setEditingSlug(null)
      setForm(EMPTY_FORM)
      refreshProfiles()
    } catch (error) {
      setMessage({ kind: 'err', text: apiErrorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  const startEdit = async (cred: ProfileCred) => {
    setEditingSlug(cred.slug)
    setMessage(null)
    setForm((f) => ({ ...f, slug: cred.slug }))
    try {
      const { profile } = await apiGetProfile(cred.slug)
      setForm((f) => ({
        ...f,
        slug: profile.slug,
        jira_cloud_url: profile.jira_cloud_url,
        jira_email: profile.jira_email,
        jira_projects: profile.jira_projects,
        llm_provider: profile.llm_provider,
        llm_model: profile.llm_model,
        story_points_field: profile.story_points_field || '',
        jira_api_token: '',
        llm_api_key: '',
      }))
      setAccessToken('')
    } catch (error) {
      setMessage({ kind: 'err', text: apiErrorMessage(error) })
    }
  }

  const cancelEdit = () => {
    setEditingSlug(null)
    setAccessToken('')
    setForm(EMPTY_FORM)
    setMessage(null)
    setTestResult(null)
  }

  const removeProfile = async (cred: ProfileCred) => {
    if (!confirm(`Delete profile '${cred.slug}'? This cannot be undone.`)) return
    try {
      profileApi.setActiveSlug(cred.slug)
      await apiDeleteProfile(cred.slug)
      profileApi.remove(cred.slug)
      refreshProfiles()
      setMessage({ kind: 'ok', text: `Profile '${cred.slug}' deleted.` })
    } catch (error) {
      setMessage({ kind: 'err', text: apiErrorMessage(error) })
    }
  }

  return (
    <div className="settings-page">
      <h2 className="component-title">⚙️ Settings</h2>
      <p className="settings-intro">
        Configure your Jira Cloud workspace and LLM provider. Each profile is stored encrypted in Supabase; the access
        token is kept only in this browser and validated as a hash by the backend.
      </p>

      {!editingSlug && (
        <a className="guide-card" href="/user-guide.html" target="_blank" rel="noreferrer">
          <span className="guide-card-icon">📖</span>
          <span>
            <strong>New to Sprint Risk Radar?</strong>
            <span className="guide-card-sub">Read the User Guide — setup, every dashboard section, and troubleshooting.</span>
          </span>
          <span className="guide-card-arrow">→</span>
        </a>
      )}

      {profiles.length === 0 && !editingSlug && (
        <div className="no-data">
          <p>No profiles saved in this browser yet. Create your first one below.</p>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="saved-profiles">
          <h3>Saved profiles (this browser)</h3>
          {profiles.map((cred) => (
            <div key={cred.slug} className="saved-profile-row">
              <span className={`profile-badge ${profileApi.activeSlug() === cred.slug ? 'active' : ''}`}>
                {profileApi.activeSlug() === cred.slug ? '● ' : ''}{cred.slug}
              </span>
              <button className="details-btn" onClick={() => onSelectProfile(cred.slug)}>Activate</button>
              <button className="details-btn" onClick={() => startEdit(cred)}>Edit</button>
              <button className="delete-btn" onClick={() => removeProfile(cred)}>Delete</button>
            </div>
          ))}
        </div>
      )}

      <div className="settings-form">
        <h3>{editingSlug ? `Edit profile: ${editingSlug}` : 'New profile'}</h3>

        <div className="form-grid">
          <label>
            Slug (identifier, lowercase + hyphens)
            <input
              value={form.slug}
              onChange={(e) => set('slug')(e.target.value.toLowerCase())}
              disabled={!!editingSlug}
              placeholder="e.g. acme-scm"
              maxLength={40}
            />
          </label>
          <label>
            Jira Cloud URL
            <input
              value={form.jira_cloud_url}
              onChange={(e) => set('jira_cloud_url')(e.target.value)}
              placeholder="https://your-domain.atlassian.net"
            />
          </label>
          <label>
            Jira email
            <input
              value={form.jira_email}
              onChange={(e) => set('jira_email')(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label>
            Jira API token {editingSlug && <em>(blank = keep current)</em>}
            <input
              value={form.jira_api_token}
              onChange={(e) => set('jira_api_token')(e.target.value)}
              placeholder="ATATT3xFfGF..."
              type="password"
              autoComplete="off"
            />
          </label>
          <label>
            Project keys (comma separated)
            <input
              value={form.jira_projects}
              onChange={(e) => set('jira_projects')(e.target.value)}
              placeholder="PFIN, MOS"
            />
          </label>
          <label>
            Story points field (optional — blank auto-detects)
            <input
              value={form.story_points_field}
              onChange={(e) => set('story_points_field')(e.target.value)}
              placeholder="customfield_10102"
            />
          </label>
        </div>

        <div className="form-grid">
          <label>
            LLM provider
            <select value={form.llm_provider} onChange={(e) => switchProvider(e.target.value)}>
              <option value="gemini">Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label>
            Model
            <input
              value={form.llm_model}
              onChange={(e) => set('llm_model')(e.target.value)}
              placeholder={defaultModels[form.llm_provider] || 'gemini-flash-latest'}
            />
          </label>
          <label>
            LLM API key {editingSlug && <em>(blank = keep current)</em>}
            <input
              value={form.llm_api_key}
              onChange={(e) => set('llm_api_key')(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder={form.llm_provider === 'gemini' ? 'AIza...' : 'sk-or-v1-...'}
            />
          </label>
        </div>

        <p className="token-note llm-data-note">
          ⚠️ On Gemini's <strong>free tier</strong>, Google may use submitted prompts for product improvement —
          use a paid-tier key if that's unacceptable. For OpenRouter, prefer providers with a
          no-training / zero-retention policy. Issue text may still reach the provider (assignees are pseudonymized).
        </p>

        <p className="token-note privacy-note">
          ℹ️ Saving shares this workspace's sprint data (assignee names, issue summaries and descriptions) with your
          chosen AI provider for analysis. Nothing is ever written back to Jira — follow-up messages are generated for
          you to copy and paste manually. See the{' '}
          <a href="/privacy.html" target="_blank" rel="noreferrer">privacy notice</a>.
        </p>

        <div className="form-actions">
          <button className="generate-btn" onClick={testConnection} disabled={testing || saving}>
            <PlugZap size={16} strokeWidth={2} />
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button className="sync-btn" onClick={saveProfile} disabled={saving || testing}>
            <Save size={16} strokeWidth={2} />
            {saving ? 'Saving...' : editingSlug ? 'Update Profile' : 'Save Profile'}
          </button>
          {editingSlug && (
            <button className="delete-btn" onClick={cancelEdit}>
              <X size={16} strokeWidth={2} />
              Cancel
            </button>
          )}
        </div>

        {testResult && (
          <div className={`test-result ${testResult.status === 'ok' ? 'ok' : 'partial'}`}>
            <pre>{testResult.text}</pre>
          </div>
        )}

        {message && (
          <div className={`form-message ${message.kind}`}>{message.text}</div>
        )}

        {!editingSlug && !accessToken && (
          <p className="token-note">
            An access token will be generated automatically on save and stored in this browser.
          </p>
        )}
      </div>
    </div>
  )
}