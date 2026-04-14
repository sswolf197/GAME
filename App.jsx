import { useState, useMemo, useCallback } from 'react'
import { useIndex, useDayData } from './hooks/useData.js'
import { CATEGORIES } from './utils/eventStyles.js'
import FilterPanel from './components/FilterPanel.jsx'
import MapCanvas from './components/MapCanvas.jsx'
import Timeline from './components/Timeline.jsx'
import TopBar from './components/TopBar.jsx'
import styles from './App.module.css'

export default function App() {
  const { index, error: indexError } = useIndex()

  const [selectedDay,   setSelectedDay]   = useState('')
  const [selectedMap,   setSelectedMap]   = useState('')
  const [selectedMatch, setSelectedMatch] = useState('')
  const [visibleCats,   setVisibleCats]   = useState(CATEGORIES)
  const [showBots,      setShowBots]      = useState(true)
  const [showHumans,    setShowHumans]    = useState(true)
  const [heatmapMode,   setHeatmapMode]   = useState('off')
  const [currentTime,   setCurrentTime]   = useState(0)
  const [selectedUser,  setSelectedUser]  = useState(null)

  const { data, loading } = useDayData(selectedDay)

  // Derived: available maps for selected day
  const maps = useMemo(() => {
    if (!data) return []
    return Object.keys(data.maps)
  }, [data])

  // When day changes, reset downstream
  const handleDayChange = (d) => {
    setSelectedDay(d)
    setSelectedMap('')
    setSelectedMatch('')
    setCurrentTime(0)
    setSelectedUser(null)
  }

  const handleMapChange = (m) => {
    setSelectedMap(m)
    setSelectedMatch('')
    setCurrentTime(0)
    setSelectedUser(null)
  }

  const handleMatchChange = (m) => {
    setSelectedMatch(m)
    setCurrentTime(0)
    setSelectedUser(null)
  }

  // Derived: matches for selected map
  const matches = useMemo(() => {
    if (!data || !selectedMap) return []
    const mapData = data.maps[selectedMap]
    if (!mapData) return []
    return Object.entries(mapData.matches).map(([id, info]) => ({
      id,
      player_count: info.player_count,
      bot_count: info.bot_count,
      duration: info.duration,
    }))
  }, [data, selectedMap])

  // Derived: current match info
  const matchInfo = useMemo(() => {
    if (!selectedMatch || !data || !selectedMap) return null
    return data.maps[selectedMap]?.matches[selectedMatch] ?? null
  }, [data, selectedMap, selectedMatch])

  // Derive: all events for current view (map + optionally match)
  const allEvents = useMemo(() => {
    if (!data || !selectedMap) return []
    const mapData = data.maps[selectedMap]
    if (!mapData) return []

    if (selectedMatch) {
      return mapData.matches[selectedMatch]?.events ?? []
    }
    // All matches on this map (cap at 5000 events for performance)
    const all = []
    for (const m of Object.values(mapData.matches)) {
      all.push(...m.events)
      if (all.length > 5000) break
    }
    return all
  }, [data, selectedMap, selectedMatch])

  // Derived: events filtered by timeline
  const timelineEvents = useMemo(() => {
    if (!currentTime || !selectedMatch) return allEvents
    return allEvents.filter(ev => ev.ts <= currentTime)
  }, [allEvents, currentTime, selectedMatch])

  // Event counts per category for TopBar
  const eventCounts = useMemo(() => {
    const counts = {}
    for (const ev of allEvents) {
      counts[ev.cat] = (counts[ev.cat] || 0) + 1
    }
    return counts
  }, [allEvents])

  const handleToggleCat = useCallback((cat) => {
    setVisibleCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }, [])

  // Minimap src
  const minimapSrc = useMemo(() => {
    if (!data || !selectedMap) return null
    const cfg = data.maps[selectedMap]
    return cfg ? `/minimaps/${cfg.minimap}` : null
  }, [data, selectedMap])

  const imgW = data?.maps[selectedMap]?.img_w ?? 1024
  const imgH = data?.maps[selectedMap]?.img_h ?? 1024
  const maxTime = matchInfo?.duration ?? 0

  const days = index?.days?.map(d => d.date) ?? []

  if (indexError) {
    return (
      <div className={styles.error}>
        <p>Could not load data index.</p>
        <p style={{color:'var(--text3)', fontSize:12, marginTop:8}}>
          Run <code>python scripts/preprocess.py</code> first, then copy the output to <code>public/data/</code>.
        </p>
        <p style={{color:'var(--text3)', fontSize:12}}>{indexError}</p>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <FilterPanel
        days={days}
        selectedDay={selectedDay}
        onDayChange={handleDayChange}
        maps={maps}
        selectedMap={selectedMap}
        onMapChange={handleMapChange}
        matches={matches}
        selectedMatch={selectedMatch}
        onMatchChange={handleMatchChange}
        visibleCategories={visibleCats}
        onToggleCategory={handleToggleCat}
        showBots={showBots}
        onToggleBots={() => setShowBots(p => !p)}
        showHumans={showHumans}
        onToggleHumans={() => setShowHumans(p => !p)}
        heatmapMode={heatmapMode}
        onHeatmapMode={setHeatmapMode}
        matchInfo={matchInfo}
      />

      <div className={styles.main}>
        <TopBar
          mapName={selectedMap}
          matchId={selectedMatch}
          eventCounts={eventCounts}
          selectedUserId={selectedUser}
          onClearUser={() => setSelectedUser(null)}
        />

        {loading && (
          <div className={styles.loadingBar}>
            <div className={styles.loadingInner} />
          </div>
        )}

        <MapCanvas
          minimapSrc={minimapSrc}
          imgW={imgW}
          imgH={imgH}
          events={timelineEvents}
          visibleCategories={visibleCats}
          showBots={showBots}
          showHumans={showHumans}
          heatmapMode={heatmapMode}
          selectedUserId={selectedUser}
          onSelectUser={setSelectedUser}
        />

        <Timeline
          maxTime={maxTime}
          currentTime={currentTime}
          onSeek={setCurrentTime}
          events={allEvents}
        />
      </div>
    </div>
  )
}
