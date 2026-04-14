import { useRef, useEffect, useCallback, useState } from 'react'
import { drawHeatmap } from '../utils/heatmap.js'
import { EVENT_STYLES, BOT_COLOR, HUMAN_COLOR } from '../utils/eventStyles.js'
import styles from './MapCanvas.module.css'

const MIN_SCALE = 0.5, MAX_SCALE = 8

export default function MapCanvas({
  minimapSrc,
  imgW = 1024,
  imgH = 1024,
  events,          // all events for this map/match (pre-filtered by timeline)
  visibleCategories,
  showBots,
  showHumans,
  heatmapMode,
  selectedUserId,
  onSelectUser,
}) {
  const containerRef = useRef(null)
  const bgCanvasRef  = useRef(null)  // minimap image
  const hmCanvasRef  = useRef(null)  // heatmap layer
  const evCanvasRef  = useRef(null)  // event markers
  const pathCanvasRef = useRef(null) // player paths

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [imgLoaded, setImgLoaded] = useState(false)
  const imgRef = useRef(null)
  const dragging = useRef(false)
  const lastPos  = useRef({ x: 0, y: 0 })

  // Load minimap image
  useEffect(() => {
    setImgLoaded(false)
    if (!minimapSrc) return
    const img = new Image()
    img.src = minimapSrc
    img.onload = () => { imgRef.current = img; setImgLoaded(true) }
    img.onerror = () => { imgRef.current = null; setImgLoaded(false) }
  }, [minimapSrc])

  // Fit transform when map/container changes
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const scale = Math.min(width / imgW, height / imgH) * 0.95
    setTransform({
      x: (width  - imgW * scale) / 2,
      y: (height - imgH * scale) / 2,
      scale,
    })
  }, [minimapSrc, imgW, imgH])

  const getCanvasSize = useCallback(() => {
    const el = containerRef.current
    if (!el) return { w: 800, h: 600 }
    const { width, height } = el.getBoundingClientRect()
    return { w: Math.floor(width), h: Math.floor(height) }
  }, [])

  // Draw background minimap
  useEffect(() => {
    const canvas = bgCanvasRef.current
    if (!canvas || !imgLoaded || !imgRef.current) return
    const { w, h } = getCanvasSize()
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    const { x, y, scale } = transform
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)
    ctx.drawImage(imgRef.current, 0, 0, imgW, imgH)
    ctx.restore()
  }, [imgLoaded, transform, imgW, imgH, getCanvasSize])

  // Filter events to what should render
  const filteredEvents = useCallback(() => {
    if (!events) return []
    return events.filter(ev => {
      if (!visibleCategories.includes(ev.cat)) return false
      if (ev.bot && !showBots) return false
      if (!ev.bot && !showHumans) return false
      return true
    })
  }, [events, visibleCategories, showBots, showHumans])

  // Draw heatmap
  useEffect(() => {
    const canvas = hmCanvasRef.current
    if (!canvas) return
    const { w, h } = getCanvasSize()
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    if (heatmapMode === 'off' || !events) return

    const { x, y, scale } = transform
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)

    const hmCanvas = document.createElement('canvas')
    hmCanvas.width = imgW; hmCanvas.height = imgH
    const hmCtx = hmCanvas.getContext('2d')

    let catFilter, rgb
    if (heatmapMode === 'kills')   { catFilter = 'kill';     rgb = [239, 68, 68]  }
    if (heatmapMode === 'deaths')  { catFilter = 'death';    rgb = [249, 115, 22] }
    if (heatmapMode === 'storm')   { catFilter = 'storm';    rgb = [129, 140, 248]}
    if (heatmapMode === 'traffic') { catFilter = 'movement'; rgb = [59, 130, 246] }

    const pts = (events || []).filter(ev => ev.cat === catFilter)
    if (pts.length) {
      drawHeatmap(hmCtx, pts, imgW, imgH, imgW, imgH, rgb, 30)
    }

    ctx.drawImage(hmCanvas, 0, 0, imgW, imgH)
    ctx.restore()
  }, [heatmapMode, events, transform, imgW, imgH, getCanvasSize])

  // Draw paths for selected user
  useEffect(() => {
    const canvas = pathCanvasRef.current
    if (!canvas) return
    const { w, h } = getCanvasSize()
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    if (!selectedUserId || !events) return

    const { x, y, scale } = transform
    const userEvents = events
      .filter(ev => ev.uid === selectedUserId && ev.cat === 'movement')
      .sort((a, b) => a.ts - b.ts)

    if (userEvents.length < 2) return

    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)

    const isBot = userEvents[0]?.bot
    ctx.strokeStyle = isBot ? BOT_COLOR : HUMAN_COLOR
    ctx.lineWidth   = 1.5 / scale
    ctx.globalAlpha = 0.7
    ctx.setLineDash([4 / scale, 3 / scale])
    ctx.beginPath()
    ctx.moveTo(userEvents[0].px, userEvents[0].py)
    for (let i = 1; i < userEvents.length; i++) {
      ctx.lineTo(userEvents[i].px, userEvents[i].py)
    }
    ctx.stroke()
    ctx.restore()
  }, [selectedUserId, events, transform, getCanvasSize])

  // Draw event markers
  useEffect(() => {
    const canvas = evCanvasRef.current
    if (!canvas) return
    const { w, h } = getCanvasSize()
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    if (!events) return

    const { x, y, scale } = transform
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale)

    const fev = filteredEvents()
    const BASE_R = 4

    for (const ev of fev) {
      const s = EVENT_STYLES[ev.cat] || EVENT_STYLES.other
      const isSelected = ev.uid === selectedUserId
      const r = (s.size || BASE_R) / scale

      ctx.globalAlpha = (ev.cat === 'movement') ? 0.4 : 0.85
      ctx.fillStyle = ev.bot ? BOT_COLOR : s.color

      if (ev.cat === 'kill') {
        // X marker
        const arm = r * 1.2
        ctx.save()
        ctx.strokeStyle = ev.bot ? BOT_COLOR : s.color
        ctx.lineWidth = Math.max(0.5, 1.5 / scale)
        ctx.beginPath()
        ctx.moveTo(ev.px - arm, ev.py - arm); ctx.lineTo(ev.px + arm, ev.py + arm)
        ctx.moveTo(ev.px + arm, ev.py - arm); ctx.lineTo(ev.px - arm, ev.py + arm)
        ctx.stroke()
        ctx.restore()
      } else if (ev.cat === 'death' || ev.cat === 'storm') {
        // Diamond
        ctx.beginPath()
        ctx.moveTo(ev.px, ev.py - r * 1.5)
        ctx.lineTo(ev.px + r, ev.py)
        ctx.lineTo(ev.px, ev.py + r * 1.5)
        ctx.lineTo(ev.px - r, ev.py)
        ctx.closePath()
        ctx.fill()
      } else if (ev.cat === 'loot') {
        // Square
        ctx.fillRect(ev.px - r, ev.py - r, r * 2, r * 2)
      } else {
        // Dot
        ctx.beginPath()
        ctx.arc(ev.px, ev.py, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Highlight ring for selected user
      if (isSelected) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5 / scale
        ctx.beginPath()
        ctx.arc(ev.px, ev.py, r * 1.8, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    ctx.restore()
  }, [events, transform, filteredEvents, selectedUserId, getCanvasSize])

  // ---- Interaction ----
  const toWorld = useCallback((cx, cy) => {
    const { x, y, scale } = transform
    return { wx: (cx - x) / scale, wy: (cy - y) / scale }
  }, [transform])

  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }

  const handleMouseUp = () => { dragging.current = false }

  const handleWheel = (e) => {
    e.preventDefault()
    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 0.89
    setTransform(t => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor))
      const ratio = newScale / t.scale
      return {
        scale: newScale,
        x: cx - (cx - t.x) * ratio,
        y: cy - (cy - t.y) * ratio,
      }
    })
  }

  const handleClick = useCallback((e) => {
    if (!events) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const { wx, wy } = toWorld(cx, cy)
    const HIT = 8 / transform.scale

    const fev = filteredEvents()
    let best = null, bestD = Infinity
    for (const ev of fev) {
      const d = Math.hypot(ev.px - wx, ev.py - wy)
      if (d < HIT && d < bestD) { bestD = d; best = ev }
    }
    onSelectUser(best ? best.uid : null)
  }, [events, filteredEvents, toWorld, transform, onSelectUser])

  const handleResetZoom = () => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const scale = Math.min(width / imgW, height / imgH) * 0.95
    setTransform({ x: (width - imgW * scale) / 2, y: (height - imgH * scale) / 2, scale })
  }

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onClick={handleClick}
    >
      <canvas ref={bgCanvasRef}   className={styles.layer} />
      <canvas ref={hmCanvasRef}   className={styles.layer} style={{ mixBlendMode: 'screen' }} />
      <canvas ref={pathCanvasRef} className={styles.layer} />
      <canvas ref={evCanvasRef}   className={styles.layer} />

      {!minimapSrc && (
        <div className={styles.empty}>
          <span>Select a date and map to begin</span>
        </div>
      )}

      <div className={styles.controls}>
        <button onClick={handleResetZoom} title="Reset zoom">⊡</button>
        <button onClick={() => setTransform(t => ({ ...t, scale: Math.min(MAX_SCALE, t.scale * 1.3) }))} title="Zoom in">+</button>
        <button onClick={() => setTransform(t => ({ ...t, scale: Math.max(MIN_SCALE, t.scale * 0.77) }))} title="Zoom out">−</button>
      </div>

      <div className={styles.scaleHint}>
        {(transform.scale * 100).toFixed(0)}%
      </div>
    </div>
  )
}
