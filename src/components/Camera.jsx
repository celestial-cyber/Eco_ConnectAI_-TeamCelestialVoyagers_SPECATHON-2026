import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Live camera capture via getUserMedia.
 *
 * Same constraint as geolocation: browsers only grant a camera over HTTPS
 * or on localhost. Every refusal gets its own message, and the file picker
 * is always there as the way through — a donor should never be stuck
 * because a laptop has no webcam.
 */
export default function Camera({ onCapture, onCancel }) {
  const video = useRef(null)
  const stream = useRef(null)
  const [status, setStatus] = useState('starting') // starting | live | error
  const [error, setError] = useState('')
  const [facing, setFacing] = useState('environment')
  const [hasMany, setHasMany] = useState(false)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  const start = useCallback(
    async (mode) => {
      stop()
      setStatus('starting')
      setError('')

      const secure =
        window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname)
      if (!secure) {
        setStatus('error')
        setError('The camera needs HTTPS. Open the site over https, or use the file picker.')
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setError('This browser has no camera support. Use the file picker instead.')
        return
      }

      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        })
        stream.current = s
        if (video.current) {
          video.current.srcObject = s
          await video.current.play().catch(() => {})
        }
        setStatus('live')
        try {
          const devs = await navigator.mediaDevices.enumerateDevices()
          setHasMany(devs.filter((d) => d.kind === 'videoinput').length > 1)
        } catch {}
      } catch (e) {
        setStatus('error')
        const map = {
          NotAllowedError: 'Camera permission was denied. Allow it in the address bar, or use the file picker.',
          NotFoundError: 'No camera found on this device. Use the file picker instead.',
          NotReadableError: 'The camera is already in use by another app.',
          OverconstrainedError: 'That camera mode is not available on this device.',
        }
        setError(map[e.name] || e.message || 'The camera could not be started.')
      }
    },
    [stop]
  )

  useEffect(() => {
    start(facing)
    return stop
  }, [facing, start, stop])

  function shoot() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    // cap the long edge: a 4K frame is a slow upload and no better for the model
    const max = 1280
    const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight))
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    c.toBlob(
      (blob) => {
        if (!blob) return
        stop()
        onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.88
    )
  }

  return (
    <div className="camera">
      <video ref={video} playsInline muted className={status === 'live' ? '' : 'hidden'} />

      {status === 'starting' && (
        <div className="camstate mono">STARTING CAMERA…</div>
      )}
      {status === 'error' && (
        <div className="camstate">
          <div style={{ color: 'var(--red)', fontSize: 13, lineHeight: 1.6, maxWidth: '34ch' }}>{error}</div>
        </div>
      )}

      {status === 'live' && <div className="camframe" aria-hidden="true" />}

      <div className="camctl">
        {status === 'live' && (
          <>
            <button type="button" className="shutter" onClick={shoot} aria-label="Take photo" />
            {hasMany && (
              <button type="button" className="btn ghost sm" onClick={() =>
                setFacing((f) => (f === 'environment' ? 'user' : 'environment'))
              }>Flip</button>
            )}
          </>
        )}
        {status === 'error' && (
          <button type="button" className="btn ghost sm" onClick={() => start(facing)}>Try again</button>
        )}
        <button type="button" className="btn ghost sm" onClick={() => { stop(); onCancel() }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
