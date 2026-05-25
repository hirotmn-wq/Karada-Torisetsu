import { useState } from 'react'
import supabase from './supabase.js'

const TEAL = '#1D9E75'

export default function Auth() {
  const [mode,     setMode]     = useState('login') // login | signup
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setDone(true)
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError('メールアドレスまたはパスワードが違います')
    }
    setLoading(false)
  }

  const s = {
    page: {
      minHeight: '100vh', background: '#f8f9fa',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Helvetica Neue', Arial, sans-serif", padding: '20px',
    },
    card: {
      background: '#fff', borderRadius: 16,
      border: '1px solid #eee', padding: '40px 36px',
      width: '100%', maxWidth: 400,
    },
    title: { fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 6, letterSpacing: '-0.3px' },
    sub:   { fontSize: 14, color: '#888', marginBottom: 32, lineHeight: 1.6 },
    label: { fontSize: 12, color: '#555', marginBottom: 6, display: 'block' },
    input: {
      width: '100%', padding: '10px 12px', fontSize: 14,
      border: '1px solid #ddd', borderRadius: 8, outline: 'none',
      boxSizing: 'border-box', marginBottom: 16,
      transition: 'border-color .2s',
    },
    btn: {
      width: '100%', padding: 12, fontSize: 14, fontWeight: 600,
      borderRadius: 10, border: 'none', background: TEAL,
      color: '#fff', cursor: 'pointer', marginTop: 8,
      opacity: loading ? 0.6 : 1,
    },
    toggle: {
      marginTop: 20, textAlign: 'center', fontSize: 13, color: '#888',
    },
    toggleLink: {
      color: TEAL, cursor: 'pointer', fontWeight: 500,
      background: 'none', border: 'none', fontSize: 13,
    },
    error: {
      background: '#fce8e8', color: '#c0392b', borderRadius: 8,
      padding: '10px 14px', fontSize: 13, marginBottom: 16,
    },
    success: {
      background: '#e1f5ee', color: TEAL, borderRadius: 8,
      padding: '14px', fontSize: 13, lineHeight: 1.6, textAlign: 'center',
    },
  }

  if (done) return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 24, marginBottom: 16 }}>📬</div>
        <div style={s.success}>
          確認メールを送信しました。<br />
          メール内のリンクをクリックしてログインしてください。
        </div>
        <button style={{ ...s.btn, marginTop: 20, background: '#f0f0f0', color: '#555' }}
          onClick={() => { setDone(false); setMode('login') }}>
          ログインに戻る
        </button>
      </div>
    </div>
  )

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.title}>カラダトリセツ</div>
        <div style={s.sub}>{mode === 'login' ? 'ログイン' : 'アカウントを作成'}</div>

        {error && <div style={s.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>メールアドレス</label>
          <input
            type="email" value={email} placeholder="your@email.com"
            onChange={e => setEmail(e.target.value)}
            style={s.input} required
          />
          <label style={s.label}>パスワード{mode === 'signup' && '（6文字以上）'}</label>
          <input
            type="password" value={password} placeholder="••••••••"
            onChange={e => setPassword(e.target.value)}
            style={s.input} required minLength={6}
          />
          <button type="submit" style={s.btn} disabled={loading}>
            {loading ? '処理中…' : mode === 'login' ? 'ログイン' : 'アカウントを作成'}
          </button>
        </form>

        <div style={s.toggle}>
          {mode === 'login' ? (
            <>アカウントをお持ちでない方は
              <button style={s.toggleLink} onClick={() => { setMode('signup'); setError('') }}>
                　新規登録
              </button>
            </>
          ) : (
            <>すでにアカウントをお持ちの方は
              <button style={s.toggleLink} onClick={() => { setMode('login'); setError('') }}>
                　ログイン
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
