import { useState, useEffect } from "react"

// VITE_BACKEND_URL is injected at Docker build time by Jenkins
// e.g.  --build-arg VITE_BACKEND_URL=http://3.94.56.78:8080
const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080"

export default function App() {
  const [messages, setMessages] = useState([])
  const [health,   setHealth]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [input,    setInput]    = useState("")

  useEffect(() => { fetchHealth(); fetchMessages() }, [])

  async function fetchHealth() {
    try {
      const r = await fetch(`${BACKEND}/api/health`)
      setHealth(await r.json())
    } catch (e) { setError(`Cannot reach backend: ${e.message}`) }
  }

  async function fetchMessages() {
    try {
      const r = await fetch(`${BACKEND}/api/messages`)
      setMessages(await r.json())
    } catch (e) { setError(`Failed to load messages: ${e.message}`) }
    finally { setLoading(false) }
  }

  async function send() {
    if (!input.trim()) return
    try {
      const r = await fetch(`${BACKEND}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "USER", content: input })
      })
      const newMsg = await r.json()
      setMessages(prev => [...prev, newMsg])
      setInput("")
    } catch (e) { setError(`Send failed: ${e.message}`) }
  }

  return (
    <div className="app">
      <header>
        <h1>CI/CD Demo Application</h1>
        <p className="subtitle">GitHub · Jenkins · Docker · Terraform · Ansible · AWS</p>
        {health && <span className={`pill ${health.type==="OK"?"green":"red"}`}>Backend {health.type}</span>}
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        <div className="badges">
          {["GitHub","Jenkins","Maven","Docker","DockerHub","Terraform","Ansible","AWS EC2"]
            .map(t => <span className="badge" key={t}>{t}</span>)}
        </div>
        <section className="card">
          <h2>Messages from Backend API</h2>
          {loading ? <p className="muted">Loading...</p> :
            <ul>
              {messages.map((m,i) => (
                <li key={i}>
                  <span className={`tag ${m.type?.toLowerCase()}`}>{m.type}</span>
                  <span className="content">{m.content}</span>
                  <span className="time">{m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ""}</span>
                </li>
              ))}
            </ul>
          }
        </section>
        <section className="card send-row">
          <input value={input} onChange={e=>setInput(e.target.value)}
                 onKeyDown={e=>e.key==="Enter"&&send()}
                 placeholder="Type a message and press Enter..." />
          <button onClick={send}>Send</button>
        </section>
      </main>
      <footer><p>Backend: {BACKEND}</p></footer>
    </div>
  )
}
